# Polaris: Platform Mapping

Polaris is an Electron app on Windows 11. The renderer is Chromium/WebView2, so this system maps to CSS and React/Motion only. SwiftUI and native mobile mappings are out of scope.

## 1. FONT LOADING

The app uses the Fontsource variable packages. They are devDependencies because Vite bundles the font files into the renderer.

```ts
import '@fontsource-variable/manrope'
import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans-sc'
import '@fontsource-variable/geist-mono'
```

Family names:

- Display: `Manrope Variable`
- Body: `Inter Variable`
- Chinese: `Noto Sans SC Variable`
- Mono: `Geist Mono Variable`

## 2. CSS CUSTOM PROPERTIES

### Dark (default, night)

```css
:root {
  --background: #080A0F;
  --surface1: #0D1018;
  --surface2: #12161F;
  --surface3: #1E2430;
  --border: #1E2430;
  --border-visible: #2A3140;
  --text1: #E8ECF4;
  --text2: #9AA4B2;
  --text3: #7A8494;
  --text4: #5B6472;
  --accent: #5EEAD4;
  --accent-subtle: #0A2A28;
  --on-accent: #07110F;
  --success: #5EEAD4;
  --success-bg: #0A2A28;
  --warning: #FBBF24;
  --warning-bg: #451A03;
  --error: #FB7185;
  --error-bg: #4C0519;
  --attention: #FBBF24;
  --attention-subtle: #451A03;
  --star-a: #5EEAD4;
  --star-b: #A78BFA;
  --priority-low: #818CF8;
  --priority-mid: #FBBF24;
  --priority-high: #FB7185;

  --font-display: "Manrope Variable", "Noto Sans SC Variable", "Segoe UI Variable Display",
    "Microsoft YaHei UI", system-ui, sans-serif;
  --font-body: "Inter Variable", "Noto Sans SC Variable", "Segoe UI Variable Text",
    "Microsoft YaHei UI", system-ui, sans-serif;
  --font-mono: "Geist Mono Variable", "Cascadia Code", "Consolas", monospace;

  --text-display: 34px;
  --text-heading: 24px;
  --text-subheading: 18px;
  --text-body: 14px;
  --text-body-sm: 13px;
  --text-caption: 11px;
  --text-label: 11px;

  --space-2xs: 2px;
  --space-xs: 4px;
  --space-sm: 8px;
  --space-control: 12px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;
  --space-3xl: 64px;
  --space-4xl: 96px;

  --radius-element: 6px;
  --radius-control: 8px;
  --radius-component: 12px;
  --radius-container: 16px;
  --radius-pill: 999px;

  --shadow-1: 0 8px 24px -18px rgba(0, 0, 0, 0.80);
  --shadow-2: 0 18px 50px -24px rgba(0, 0, 0, 0.80);
  --shadow-3: 0 32px 80px -32px rgba(0, 0, 0, 0.85);

  --motion-fast: 120ms;
  --motion-normal: 200ms;
  --motion-slow: 320ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-emphasis: cubic-bezier(0.22, 1, 0.36, 1);
}
```

### Light (day)

```css
[data-theme="light"] {
  --background: #F4F3EF;
  --surface1: #FBFAF7;
  --surface2: #E5E1D8;
  --surface3: #D2CEC3;
  --border: #E5E1D8;
  --border-visible: #D2CEC3;
  --text1: #14120F;
  --text2: #5F5A51;
  --text3: #6B655B;
  --text4: #8F897D;
  --accent: #0F766E;
  --accent-subtle: #F0FDFA;
  --on-accent: #FFFFFF;
  --success: #0F766E;
  --success-bg: #ECFDF5;
  --warning: #B45309;
  --warning-bg: #FFFBEB;
  --error: #BE123C;
  --error-bg: #FFF1F2;
  --attention: #B45309;
  --attention-subtle: #FFFBEB;
  --star-a: #0F766E;
  --star-b: #7C3AED;
  --priority-low: #4F46E5;
  --priority-mid: #B45309;
  --priority-high: #BE123C;

  --shadow-1: 0 8px 24px -18px rgba(20, 18, 15, 0.25);
  --shadow-2: 0 18px 50px -24px rgba(20, 18, 15, 0.30);
  --shadow-3: 0 32px 80px -32px rgba(20, 18, 15, 0.35);
}
```

## 3. APP ALIASES

The existing `src/renderer/src/styles/globals.css` uses short names. Map them to the canonical tokens:

| App token | Canonical token |
|-----------|-----------------|
| `--bg` | `--background` |
| `--line` | `--border` |
| `--line-strong` | `--border-visible` |
| `--text` | `--text1` |
| `--text-secondary` | `--text2` |
| `--text-tertiary` | `--text3` |
| `--accent` | `--accent` |
| `--accent-2` | `--star-b` |
| `--warning` | `--warning` |
| `--danger` | `--error` |
| `--font-ui` | `--font-body` |
| `--font-display` | `--font-display` |
| `--font-mono` | `--font-mono` |

The app's translucent surfaces (`--surface-1`, `--surface-2`, `--hover`) are derived from the canonical surfaces with alpha. Keep them translucent only for hover and overlay tints; content cards use the canonical solid surfaces.

## 4. TAILWIND V4 THEME

The app uses Tailwind v4 CSS-first configuration. Add these mappings to `@theme`:

```css
@theme {
  --font-sans: "Inter Variable", "Noto Sans SC Variable", "Segoe UI Variable Text",
    "Microsoft YaHei UI", system-ui, sans-serif;
  --font-display: "Manrope Variable", "Noto Sans SC Variable", "Segoe UI Variable Display",
    "Microsoft YaHei UI", system-ui, sans-serif;
  --font-mono: "Geist Mono Variable", "Cascadia Code", "Consolas", monospace;

  --color-background: var(--background);
  --color-surface-1: var(--surface1);
  --color-surface-2: var(--surface2);
  --color-surface-3: var(--surface3);
  --color-line: var(--border);
  --color-line-strong: var(--border-visible);
  --color-text: var(--text1);
  --color-text-secondary: var(--text2);
  --color-text-tertiary: var(--text3);
  --color-accent: var(--accent);
  --color-accent-subtle: var(--accent-subtle);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-danger: var(--error);
}
```

## 5. MOTION

CSS:

```css
transition:
  color var(--motion-fast) var(--ease-standard),
  background var(--motion-fast) var(--ease-standard),
  border-color var(--motion-fast) var(--ease-standard);
```

Motion (React):

```ts
const springs = {
  list: { type: 'spring', stiffness: 420, damping: 36 },
  sheet: { type: 'spring', stiffness: 380, damping: 40 },
  palette: { type: 'spring', stiffness: 500, damping: 40 }
}
```

Wrap the app in `<MotionConfig reducedMotion="user">`. CSS `@media (prefers-reduced-motion: reduce)` covers CSS transitions; MotionConfig covers JS springs.

## 6. WINDOWS NOTES

- Do not use full-window Mica or transparency. A titlebar-only Mica experiment is allowed with an opaque content surface and a solid fallback.
- Keep ClearType sharp: content surfaces are opaque; transparent surfaces are only the titlebar strip, scrims, and overlays.
- The native titlebar overlay uses `symbolColor` #9CA3AF on ink and #4B5563 on paper. Update it through the existing `app:set-theme` IPC.
- The app is keyboard-first: focus traps, visible rings, and undo toast are part of the system, not optional polish.