# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Polaris is a local-first Windows 11 to-do app: Electron 45 main process, sandboxed React 19 renderer, better-sqlite3 storage, NSIS packaging. The interface is Simplified Chinese; keep user-facing copy Chinese.

Visual decisions follow `design-system/polaris-design/SKILL.md`: one four-point star, one teal signal, night is cool ink and day is warm porcelain, Manrope/Inter/Noto Sans SC/Geist Mono.

## Commands

```bash
npm install
npm run dev         # electron-vite dev server
npm run typecheck   # tsc for node + web tsconfigs
npm run build       # electron-vite build -> out/
npm run smoke       # build first; launches Electron with POLARIS_SMOKE
npm run preview     # preview the production build
npm run build:win   # build + electron-builder NSIS -> dist/
```

- There is no ESLint, Prettier, or unit-test runner. `npm run smoke` is the only automated check and exits non-zero on failure. Run `npm run build && npm run smoke` after behavior changes.
- `npm run smoke` drives the real UI through `webContents.executeJavaScript` against a temporary userData profile, so it does not touch a running app's database: quick add, detail edit, Esc save, complete, delete/undo, command palette, theme, auto-start, recurrence, the recurrence notice, and quick-add parsing. It cleans up its tasks and restores theme/auto-start. Assertions live in `runSmokeTest()` in `src/main/index.ts`; the parser's table-driven and fuzz checks live in `runParseAssertions()` in the same file. Expected values are written as literals, never recomputed through the code under test. The failed-submit path is exercised by dropping the `tasks:create` IPC channel and restoring it with `registerTaskCreate()` — `contextBridge` freezes `window.polaris`, so it cannot be stubbed from the page. Height assertions use sub-pixel rects and are verified at 100/125/150/200% display scaling and under reduced motion.
- Screenshots: after `npm run build`, run `POLARIS_SHOT=<mode> npx electron .`; it writes `screenshot*.png` to the repo root. Modes are the `captureDemo` branches (`detail`, `palette`, `projects`, `reminder`, `reminder-detail`, `settings`, `toast`, `recurrence`, `parse`, `parse-past`, `parse-notice`, `parse-blocked`, each with a `light-` variant; anything else captures the main view). `POLARIS_SCREENSHOT=1` captures only the main window and quits.
- Packaging is unsigned and per-user. Verify with `dist/win-unpacked/Polaris.exe`; do not install/uninstall the app unless asked.
- If the Electron binary is missing after install (npm 11 blocks lifecycle scripts), run `node node_modules/electron/install.js`. The `allowScripts` list in `package.json` whitelists packages that need install scripts.

## Process and data architecture

- `src/main` is the only privileged process. `src/preload/index.ts` exposes a typed `window.polaris`; the renderer runs with `contextIsolation` and `sandbox`, no Node access. `PolarisApi` in `src/shared/types.ts` plus the declaration in `src/renderer/src/env.d.ts` are the contract.
- IPC goes renderer → preload → `src/main/ipc.ts`, where every payload is validated with zod. Adding a data operation means updating `shared/types.ts`, `preload/index.ts`, `main/ipc.ts`, and `main/db.ts` together.
- SQLite (`src/main/db.ts`) lives at Electron `userData/polaris.db` in WAL mode, called synchronously from the main process. Tasks are soft-deleted via `deleted_at`; undo calls `restoreTask`. Migrations are sequential `PRAGMA user_version` blocks in `migrate()`; append a new block and never edit one that has shipped.
- All timestamps are ISO UTC strings. Grouping and formatting happen in the renderer (`src/renderer/src/lib/dates.ts`), not in the DB.

## Recurrence and reminders

- Recurrence rules are RFC 5545 strings executed by `rrule` in `src/shared/recurrence.ts`. `rrule` treats a Date's UTC fields as a floating wall clock, so the code converts local wall time in and out (`toWallTime`/`fromWallTime`) to keep 18:00 at 18:00. COUNT and UNTIL are rejected. The monthly preset clamps 29–31 to the last day of short months (`nextMonthlyClamped`).
- Completing a recurring task is one transaction in `updateTask`: the completed instance keeps its history but loses its rule, and a new active task is inserted with the next due date plus the same project, priority, notes, and rule. A reminder is inherited as an offset before due, only when that offset is 0–7 days. Un-completing does not remove the spawned task.
- Reminders (`src/main/reminders.ts`) use a 30-second interval plus `powerMonitor` resume, a queue, and one custom frameless BrowserWindow at the bottom-right. `reminded_at` is written only in `ready-to-show`, so a failed load or a quit leaves the reminder pending. Missed reminders fire on the next launch. Reminders only work while Polaris is running (closing the window keeps it in the tray).
- The reminder window loads the same renderer at `#/reminder/<taskId>`; `src/renderer/src/main.tsx` switches to `ReminderView` from that hash.

## Quick-add parsing

- `src/shared/quickAddParse.ts` is a pure function (no React, no DOM, no Node) shared by the renderer and the smoke assertions. `parseQuickAdd(raw, { now, projects, dismissed })` returns the title, `dueAt`, `projectId`, `priority`, the token spans, the chips and the screen-reader announcement. `now` is injected so tests can pin the clock.
- The pipeline is fixed: length-preserving normalization → marker scan (`#project`, `!priority`) → mask table + guards → overlap resolution → punctuation merge → head/tail anchoring → slot merge → time layering → title. Read the step comments before changing any stage; the order is load-bearing.
- Chinese has no word boundaries, so `\b` and lookbehind are useless. Precision comes from the mask table, the character guards, and anchoring: a date is only consumed when it touches the start or the end of the string. Widening the grammar without widening the masks will eat words out of titles.
- Offsets are UTF-16 code unit indices into the raw string, half-open. They feed both `String.slice` and `setSelectionRange`. Switching to code point counting misaligns the caret and the title.
- Never derive weekday or digit values with `indexOf` on the character sets: `WD` has eight characters for seven weekdays and `ZH` has both `零` and `〇`. Use the explicit `DOW_IDX` / `ZH_DIGIT` maps.
- The input's value is never rewritten. Dismissing a chip records `key -> recognizable candidate count` (`parse.candidateCounts`) in `dismissed`; `pruneDismissed` releases a key once the text stops occurring that many times. Counting raw substrings instead would let a guard-rejected occurrence inflate the count and resurrect a cancelled date when the user edits the title. Both functions are identity-preserving so they can be used inside `setState` without a render loop. Prune only in handlers that change `parseText`, never in an effect that depends on `dismissed`.
- A token's key uses its core span, never the punctuation merged around it, so typing a `。` beside a cancelled `#工作` does not resurrect the chip. Dismissal is re-checked after the merge. Markers — including ambiguous duplicates — are masked regardless of dismissal, which is what lets the tail anchor see through a cancelled `#项目` and stops a duplicate project named `明天` from being eaten as a date.
- Project names are normalized on both sides of the comparison; a project legitimately named `项目１` must match `#项目1`.
- The clock is read through one `readNow()` helper shared by the preview memo and `submit()`. Two clock sources is how a chip promises a date the saved task never gets.
- `focusAfterDismiss` decides from `parseRef`, not a DOM query: `AnimatePresence` keeps the exiting strip's buttons mounted, so a query would focus a node that unmounts milliseconds later and strand focus on `<body>`.
- Overlap tests use `overlapIndex` (sorted spans + prefix-max binary search) and anchoring uses start/end maps. The naive `.some(overlaps)` and `.find` scans are quadratic, and parsing runs on every keystroke.
- `formatParsedDue` in the same module is the app's only due-date formatter; `lib/dates.ts` `formatDue` delegates to it. Keep it that way so chips, rows, detail, palette, reminder and the submit receipt cannot disagree.
- IME: `compositionstart` freezes `parseText`, `onChange` still updates the controlled value, and the keydown guard checks `isComposing`, `keyCode === 229`, the composing ref and a 30ms post-composition grace window. Removing any of the four reintroduces mid-composition submits.
- Esc is handled on `.quick-add-shell` and must `stopPropagation`: `TaskDetail` listens on `window` and would otherwise close the inspector instead of clearing the draft.
- The frame lives on `.quick-add-shell` with `min-height: 56px`, not on `.quick-add`. Under fractional display scaling a 1px border snaps to a sub-pixel used value, so a fixed row height alone would not reproduce the 56px collapsed frame. Measure with `getBoundingClientRect`, not `offsetHeight`.

## Window lifecycle

- Single-instance lock; a second launch focuses the existing window. Closing the main window hides it to the tray unless `isQuitting`; quitting is done from the tray menu (test-mode `window-all-closed` quits directly). `--hidden` starts to tray for auto-start via `app.setLoginItemSettings`.
- The window uses `titleBarStyle: 'hidden'` with `titleBarOverlay`. Theme changes go through `app:set-theme` to recolor the native caption buttons and window background; the renderer sets `data-theme` and CSS variables.
- `POLARIS_SMOKE`, `POLARIS_SHOT`, and `POLARIS_SCREENSHOT` disable `--hidden` and alter quit behavior; keep those harness paths working.

## Renderer

- No router. `useTaskStore` (Zustand) owns tasks, projects, view, project filter, selection, and palette; `TaskView` derives the visible and completed lists. `TaskDetail` is a 360px third grid column at ≥1180px (`role="region"`, no focus trap) that collapses to 0px with a 220ms grid transition when no task is selected, and a 400px modal sheet below that (`role="dialog"`, trap). `CommandPalette` and `SettingsPanel` remain traps; `useFocusTrap` maintains a trap stack so overlapping overlays do not fight over Tab.
- Task detail autosaves title and notes with a 500ms debounce, flushes on blur/Esc/task switch/close/unmount, and serializes saves per task. Deadline, reminder, and recurrence are human-readable rows with anchored popovers; project and priority stay inline for one-click edits.
- Theme bootstrapping happens twice on purpose: the inline script in `src/renderer/index.html` sets `data-theme` before first paint, then `useThemeStore`/`ThemeSync` keep it in sync and notify the main process. The localStorage key is `polaris-theme`.
- Accessibility is part of the design system: keep `MotionConfig reducedMotion="user"`, visible focus rings, focus traps with focus restoration, `aria-hidden` on decorative icons, and labels on icon-only controls.
- Styling is one stylesheet, `src/renderer/src/styles/globals.css`, using Tailwind v4 `@theme` plus CSS variables for both themes. There is no `tailwind.config.*`. Prefer existing tokens (`--text-*`, `--surface-*`, `--accent`, spacing and radius variables) over raw values.
- For UI work, keep the established pipeline: UI UX Pro Max for direction, hue for the brand system artifacts, web-design-guidelines for web compliance, unslop for the final craft pass. Tokens and component rules are documented in `design-system/polaris-design/references/`.

## Conventions and gotchas

- TypeScript 7 has no `baseUrl`; `@shared` and `@renderer` are relative paths in `tsconfig.*.json` and `electron.vite.config.ts`. Keep them in sync.
- Existing style: 2 spaces, single quotes, no semicolons.
- Priorities are integers 0–3 (`0 无`, `1 低`, `2 中`, `3 高`). A recurrence rule requires a due date: the DB rejects a rule without one, and the UI disables the recurrence chips until a due date exists.
- better-sqlite3 is a native module rebuilt for Electron by electron-builder (`@electron/rebuild`, `asarUnpack: **/*.node`). Do not rebuild it for plain Node.
- Generated assets: `node scripts/make-app-icon.mjs` writes `build/icon.png` and `build/icon.ico`; `node scripts/make-tray-icon.mjs` writes `src/main/tray-icon.ts`. Regenerate instead of hand-editing.
- `README.md` is user-facing; update it when behavior, commands, or packaging change. Known limitations are listed there (mica reserved, reminders need the app running, un-complete recurrence semantics).