# Polaris: Components

## 1. BUTTONS

| Variant | Background | Text | Border | Radius | Height |
|---------|-----------|------|--------|--------|--------|
| Primary | `--accent` | `--on-accent` | none | 8px | 36px |
| Secondary | `--surface1` | `--text1` | 1px `--border-visible` | 8px | 36px |
| Ghost | transparent | `--text2` | none | 8px | 32px |
| Destructive | `--error-bg` | `--error` | 1px `--error` | 8px | 32px |

Specs:

| Property | Value |
|----------|-------|
| Padding | 0 14px (primary/secondary), 0 10px (ghost/destructive) |
| Font | Inter, 13px, weight 600 |
| Focus | 2px `--accent` ring; accent-filled controls take `--on-accent` at a negative offset (ring inside the fill), accent-bordered controls drop the border while focused — the ring never matches its own surface |
| Hover | Primary brightness 1.06; secondary `--surface2`; ghost `--surface2`; destructive stronger error tint |
| Active | No layout shift; reduce brightness or add a 1px inner shadow |
| Disabled | Opacity 0.4, no hover, no focus |

The reminder card's primary button is 34px high and uses the same accent / on-accent pair. It is not a gradient.

## 2. INPUTS

| Property | Value |
|----------|-------|
| Height | 38px |
| Background | `--surface2` |
| Border | 1px `--border` |
| Focus border | `--accent` |
| Focus ring | 3px `--accent` at 8% opacity |
| Radius | 8px |
| Padding | 0 10px |
| Font | Inter, 13px |
| Placeholder | `--text3` |
| Error | `--error` border and helper text |
| Disabled | Opacity 0.4 |

Textarea: min-height 104px, padding 10px 12px, line-height 1.65, resize none. Date and time use the in-app picker (month grid plus a segmented time field), never the native `datetime-local` popup.

## 3. TASK ROWS

| Property | Value |
|----------|-------|
| Min height | 44px |
| Padding | 12px |
| Radius | 12px |
| Default | Transparent |
| Hover | `--surface2` + 1px `--border` |
| Selected | `--accent-subtle` + 1px `--border-visible` |
| Completed | Title `--text3` + line-through; check stays `--accent` |
| Title | Inter 14px / 1.6 / `--text1` |
| Meta | Inter 11px / 1.5 / `--text3` |
| Times | Geist Mono 11px, tabular numerals |
| Project dot | 7px, 1px `--border-visible` ring, darken slightly in light mode |
| Delete | Hidden until hover or focus; 14px icon; `--error` on hover |

The checkbox is a 20px circle with a 1.5px `--border-visible` stroke. Checked state fills `--accent`, checkmark `--on-accent`, 2.2px stroke. No shadow on the row.

## 4. NAVIGATION

Sidebar: 252px wide, `--background` gradient, 1px right border. Section labels: 11px, 600, `--text3`, 0.06em tracking.

| Property | Value |
|----------|-------|
| Nav item height | 36px |
| Radius | 8px |
| Gap | 2px |
| Default text | `--text2` |
| Hover | `--surface2` |
| Active | `--accent-subtle` + 1px accent border |
| Active text | `--text1` |
| Active icon | `--accent` |
| Count | Geist Mono 11px, `--text3` |

Search trigger: 36px high, `--surface2`, 1px `--border`, 8px radius, 12px text. `Ctrl K` badge uses Geist Mono 9px.

Main header: display 34px / 1.15 / 600. Eyebrow 11px uppercase. No decorative background behind the title.

## 5. CHIPS, TAGS, PRIORITY

| Component | Height | Radius | Background | Text |
|-----------|--------|--------|------------|------|
| Project chip | 28px | 8px | `--surface1` | `--text2` |
| Project chip active | 28px | 8px | `--accent-subtle` | `--accent` |
| Priority segment | 30px | 8px | `--surface1` | `--text2` |
| Priority low active | 30px | 8px | indigo tint | `--priority-low` |
| Priority mid active | 30px | 8px | amber tint | `--priority-mid` |
| Priority high active | 30px | 8px | rose tint | `--priority-high` |
| Status pill | 18px | 999px | status tint | status foreground |

Chips are not pills. Only status badges use the 999px pill.

## 6. OVERLAYS

### Task detail inspector

Wide windows (≥1180px) use a persistent 360px third column. It is an inline landmark, not a modal: opaque `--panel-bg`, 1px left `--border-visible`, no shadow, no blur, `role="region"`. List rows remain interactive and no focus trap is used.

Below 1180px it becomes a `min(400px, viewport - 32px)` modal sheet with a scrim, Level 3 shadow, `role="dialog"`, a focus trap, and focus restoration to the task row.

| Property | Value |
|----------|-------|
| Background | `--panel-bg`, opaque in both themes |
| Border | 1px left `--border-visible` |
| Radius | 0 |
| Header | 48px; project name + close |
| Body | scrolls; 16px 20px 20px |
| Footer | 40px, fixed; ghost delete + Esc hint |
| Title | Manrope 24px / 1.2 / 600, max 2 lines |
| Summary | 11px `--text3`, one line |
| Actions | 32px; one solid accent, others ghost |
| Notes | 13px; empty one line, max 40vh |
| Schedule rows | 36px; label 64px / 11px, value 13px |
| Popover | 280px, Level 2 shadow, `role="dialog"`; due 368 / reminder 402 / confirm-clear 408, cap 420, no scrolling |
| Chips | 28px; priority segments 30px |
| Delete | Ghost footer, danger on hover/focus, 6s undo |
| Focus | Wide: no trap; narrow: trap and restore |

The six repeated fields stay readable: project and priority are inline one-click controls; deadline, reminder, and recurrence use human-readable rows with anchored popovers. The footer never scrolls with the body.

### Command palette

| Property | Value |
|----------|-------|
| Width | min(640px, viewport - 48px) |
| Max height | min(540px, viewport - 180px) |
| Background | `--surface1` |
| Radius | 16px |
| Shadow | Level 3 |
| Scrim | Light: `rgba(23,26,33,.22)`; dark: `rgba(3,5,9,.48)` |
| Input row | 54px, 1px bottom border |
| Row height | 40px |
| Active row | `--accent-subtle` |
| Focus | Trap inside; focus the input; restore the trigger on close |

No gradients. No glass on the row. The panel itself is opaque.

### Settings panel

440px wide, `--surface1`, 16px radius, level 3 shadow, centered overlay. Rows use 1px divider, 13px title, 11px description. The switch is the only control that changes color.

### Reminder card

420 × 212px, opaque edge-to-edge `--panel-bg` surface; corners and shadow are drawn by the OS (Windows 11 DWM), bottom-right of the display work area. One surface only — never a rounded card inset inside a padded shell. Primary button uses `--accent` / `--on-accent`; secondary uses `--surface1` / `--text2`. Title, meta and actions are `flex: none`; the project name is a single ellipsised line. The card is draggable; actions and close are not.

## 7. TOAST

| Property | Value |
|----------|-------|
| Position | Bottom center, 24px above the window edge |
| Height | 44px |
| Max width | 420px |
| Background | `--surface1` |
| Radius | 12px |
| Shadow | Level 2 |
| Font | Inter 12px / `--text1` |
| Action | `--accent` text, 1px accent border, 8px radius |
| Auto-dismiss | 6000ms |
| Live region | `aria-live="polite"`, `aria-atomic="true"` |

Only destructive actions get a toast. Success is silent; the result is visible in the UI.

## 8. SWITCH

| Property | Value |
|----------|-------|
| Track | 38 × 22px, radius 999px |
| Track off | `--surface2`, 1px `--border-visible` |
| Track on | `--accent`, no border |
| Thumb | 16px white circle, 2px inset |
| Thumb travel | 16px |
| Focus | 2px accent ring |
| Disabled | Opacity 0.45 |

## 9. CHECKBOX

| Property | Value |
|----------|-------|
| Size | 20px circle |
| Unchecked | 1.5px `--border-visible` |
| Hover | Border `--accent` |
| Checked | Fill `--accent` |
| Checkmark | `--on-accent`, 2.2px stroke |
| Focus | 2px accent ring |
| Transition | 120ms scale and fill |

## 10. PROGRESS RING

44px outer, 3px stroke, track `--border`, fill solid `--accent`, round line caps. Label uses Geist Mono 12px. The brand gradient is reserved for the star mark and the empty-state composition.

## 11. STATE PATTERNS

### Empty state

Centered composition: 88px orbit + four-point star, subheading `18px / 600 / --text2`, body `14px / 1.6 / --text3`, primary CTA below. Generous top padding (76px+). One CTA only.

### Loading

Inline loading uses a 26px conic spinner; full-screen loading uses the same spinner with 12px `--text3` copy. Never skeleton a task row that will appear in under 300ms.

### Error

Inline error: `--error` text at 11px below the field. Screen-level error: a bordered `--error-bg` surface with a retry action. No red text on a colored background without a border.

### Disabled

Opacity 0.4, no hover, no focus, layout unchanged. Borders fade to `--border`.

### Focus

Every custom control uses a 2px `--accent` ring with a 2px offset. The ring must remain visible against both paper and ink. Overlays trap focus and restore it on close.