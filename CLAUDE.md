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
- `npm run smoke` drives the real UI through `webContents.executeJavaScript` against the local userData database: quick add, detail edit, complete, delete/undo, command palette, theme, auto-start, recurrence, and the recurrence notice. It cleans up its tasks and restores theme/auto-start. Assertions live in `runSmokeTest()` in `src/main/index.ts`.
- Screenshots: after `npm run build`, run `POLARIS_SHOT=<mode> npx electron .`; it writes `screenshot*.png` to the repo root. Modes are the `captureDemo` branches (`detail`, `palette`, `projects`, `reminder`, `reminder-detail`, `settings`, `toast`, `recurrence`, each with a `light-` variant; anything else captures the main view). `POLARIS_SCREENSHOT=1` captures only the main window and quits.
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

## Window lifecycle

- Single-instance lock; a second launch focuses the existing window. Closing the main window hides it to the tray unless `isQuitting`; quitting is done from the tray menu (test-mode `window-all-closed` quits directly). `--hidden` starts to tray for auto-start via `app.setLoginItemSettings`.
- The window uses `titleBarStyle: 'hidden'` with `titleBarOverlay`. Theme changes go through `app:set-theme` to recolor the native caption buttons and window background; the renderer sets `data-theme` and CSS variables.
- `POLARIS_SMOKE`, `POLARIS_SHOT`, and `POLARIS_SCREENSHOT` disable `--hidden` and alter quit behavior; keep those harness paths working.

## Renderer

- No router. `useTaskStore` (Zustand) owns tasks, projects, view, project filter, selection, and palette; `TaskView` derives the visible and completed lists. Overlays (`TaskDetail`, `CommandPalette`, `SettingsPanel`) render from `App`/`Sidebar` and share `useFocusTrap`, which maintains a trap stack so overlapping overlays do not fight over Tab.
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