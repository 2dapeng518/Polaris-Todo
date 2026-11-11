---
name: polaris-design
description: "This skill should be used when the user explicitly says 'Polaris style', 'Polaris design', '/polaris-design', or directly asks to use/apply the Polaris design system. NEVER trigger automatically for generic UI or design tasks."
version: 1.0.0
allowed-tools: [Read, Write, Edit, Glob, Grep]
---

# Polaris

You are a senior product designer. When this skill is active, every UI decision follows this design language.

**Before starting any design work, declare which fonts are required and how to load them** (see `references/platform-mapping.md`). Never assume fonts are already available.

---

## 1. DESIGN PHILOSOPHY

Polaris is the still point in a moving day. It borrows the calm of a night sky and the clarity of good paper: one star for orientation, one teal signal for action, everything else quiet. Night is cool ink; day is warm porcelain; the four-point star is the constant. The interface should feel like a well-made desk tool, precise and warm, never decorative.

The primary tension is **technical precision softened by human calm**. Dense enough to be useful, quiet enough to think in.

---

## 2. CRAFT RULES

1. **One star, one signal.** The brand gradient (teal to violet) belongs only to the star mark and the empty-state composition. Every action, including the progress ring, is solid teal. Amber is reserved for attention and reminder moments, never for primary actions.
2. **Night and day, not inverted.** Dark mode is cool ink; light mode is warm porcelain. The star is the constant across both. Never derive one mode by inverting the other.
3. **Type does the hierarchy.** Manrope for display, Inter for body, Noto Sans SC for Chinese, Geist Mono for counts and timestamps. Weight and scale carry hierarchy; color and boxes do not. Chinese labels never go below 11px.
4. **Quiet surfaces.** Inline rows use a surface tint and a 1px border, never a shadow. Shadows belong only to floating surfaces: quick add, command palette, detail drawer, reminder card, toast. Radii are 6 / 8 / 12 / 16, never pills for task rows.
5. **Motion confirms, never decorates.** 120ms micro, 200ms standard, 320ms emphasis. Springs are soft (list 420/36, sheet 380/40, palette 500/40). Reduced motion renders the final state immediately. Animate one or two key elements per view, never every row.
6. **Keyboard is a first-class surface.** Every custom control has a visible focus ring. Modal drawers, palettes, and dialogs trap focus and restore it on close. A persistent inline inspector is a landmark, not a modal: it must not trap focus, and it must return focus to the list when it closes. Destructive actions get an undo path. Icon-only controls have an accessible name and decorative icons are hidden from the accessibility tree.

---

## 3. ANTI-PATTERNS

- No teal-to-violet gradient on navigation, checkboxes, or buttons. The gradient is a brand moment, not a UI texture.
- No pure `#000000` or `#FFFFFF` page backgrounds. Use ink and paper.
- No second accent color in one view. Amber is attention; violet is the star and low-priority only.
- No shadows on inline task rows or content cards. No glass or backdrop blur on content surfaces; blur is for overlays only.
- No Chinese text below 11px and no 0.12em letter-spacing on Chinese labels.
- No continuous decorative animation. Loading indicators may spin; nothing else loops.
- No overshoot springs on dense task lists.
- No icon-only control without `aria-label`; no decorative icon without `aria-hidden="true"`.
- No modal, drawer, or palette without a focus trap and focus restoration. A persistent inline inspector is exempt because it is not modal; it still needs an accessible name and a clear focus return.
- No focus left behind a scrim; no sticky surface covering a focused control.
- No color-only state. Completed, priority, and project meaning also carry a shape, label, or icon.
- No full-window Mica or transparency. A titlebar-only Mica experiment is allowed with a solid fallback; the content stays opaque.
- No radius above 16px on cards, panels, or task rows. Pills are for tags and status only.

---

## 4. WORKFLOW

1. **Declare fonts**: check `references/platform-mapping.md` for the loader.
2. **Set tokens**: apply the CSS variables from `references/tokens.md`.
3. **Build components**: follow `references/components.md`.
4. **Check hierarchy**: squint test: can you tell what matters first?
5. **Verify both modes**: night and day must each feel intentional.
6. **Test extremes**: long Chinese titles, empty state, one item, 100 items, keyboard only.
7. **Check focus and motion**: tab through every overlay; test with reduced motion enabled.
8. **Platform adapt**: Electron/Chromium only; use CSS and Motion, not native mobile assumptions.

---

## 5. REFERENCE FILES

| File | Contains |
|------|----------|
| `references/tokens.md` | Fonts, type scale, color system, spacing, radii, elevation, motion, iconography |
| `references/components.md` | Buttons, inputs, task rows, navigation, chips, overlays, toast, switch, checkbox, progress, states |
| `references/platform-mapping.md` | CSS custom properties, app aliases, Tailwind v4 theme, font loading, motion tokens |

The live Polaris app (`src/renderer`) is the canonical app-screen preview. This system does not ship separate marketing mockups.