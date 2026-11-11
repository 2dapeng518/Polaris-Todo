# Polaris: Tokens

## 0. PRIMITIVES

### Paper and Ink: the day/night neutral shift

Polaris deliberately uses two neutral temperatures. Paper is warm and belongs to daylight. Ink is cool and belongs to night. This is a brand decision, not an inversion.

**Paper** (warm, light mode)

| Step | Hex | Use |
|------|-----|-----|
| 50 | `#F4F3EF` | Page background |
| 100 | `#FBFAF7` | Cards and elevated surfaces |
| 200 | `#E5E1D8` | Borders and muted surfaces |
| 300 | `#D2CEC3` | Strong borders and input wells |
| 400 | `#A9A398` | Disabled and placeholder text |
| 450 | `#8F897D` | Quaternary text |
| 500 | `#7C766B` | Muted text |
| 550 | `#6B655B` | Tertiary text |
| 600 | `#5F5A51` | Secondary text |
| 700 | `#46423B` | Strong dark accent on paper |
| 800 | `#322F2A` | Deep paper ink |
| 900 | `#211F1B` | Near-black paper ink |
| 950 | `#14120F` | Primary text on paper |

**Ink** (cool, dark mode)

| Step | Hex | Use |
|------|-----|-----|
| 50 | `#E8ECF4` | Primary text on ink |
| 100 | `#C7D0DC` | High-contrast secondary |
| 200 | `#9AA4B2` | Secondary text |
| 300 | `#7A8494` | Tertiary text |
| 400 | `#5B6472` | Disabled and quaternary |
| 500 | `#3E4756` | Muted borders |
| 600 | `#2A3140` | Strong border |
| 700 | `#1E2430` | Border and tertiary surface |
| 800 | `#12161F` | Secondary surface |
| 900 | `#0D1018` | Primary surface |
| 950 | `#080A0F` | Page background |

### Brand: Teal signal

| Step | Hex |
|------|-----|
| 50 | `#F0FDFA` |
| 100 | `#CCFBF1` |
| 200 | `#99F6E4` |
| 300 | `#5EEAD4` |
| 400 | `#2DD4BF` |
| 500 | `#14B8A6` |
| 600 | `#0F766E` |
| 700 | `#115E59` |
| 800 | `#134E4A` |
| 900 | `#0A2A28` |
| 950 | `#041A18` |

The light accent is `brand.600`, the dark accent is `brand.300`.

### Star: violet secondary

Used only in the four-point mark, the progress ring, and the empty-state composition. Not a UI accent.

`star.300 #C4B5FD`, `star.400 #A78BFA`, `star.500 #8B5CF6`, `star.600 #7C3AED`, `star.700 #6D28D9`.

### Status colors

| Role | Light | Dark | Use |
|------|-------|------|-----|
| Success | `#0F766E` | `#5EEAD4` | Completed, confirmed |
| Success tint | `#ECFDF5` | `#0A2A28` | Success background |
| Warning / attention | `#B45309` | `#FBBF24` | Reminder, due soon, caution |
| Warning tint | `#FFFBEB` | `#451A03` | Attention background |
| Error | `#BE123C` | `#FB7185` | Destructive, overdue |
| Error tint | `#FFF1F2` | `#4C0519` | Error background |
| Priority low | `#4F46E5` | `#818CF8` | Low priority |
| Priority mid | `#B45309` | `#FBBF24` | Medium priority |
| Priority high | `#BE123C` | `#FB7185` | High priority |

### Spacing primitives

`[0, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96]`

### Radii primitives

`[0, 6, 8, 12, 16, 999]`

---

## 1. TYPOGRAPHY

### Font stack

| Role | Font | Fallback | Weight | Use |
|------|------|----------|--------|-----|
| Display | Manrope Variable | Noto Sans SC Variable, Segoe UI Variable Display, Microsoft YaHei UI | 600 | Screen titles, dialog titles, the Polaris wordmark |
| Body / UI | Inter Variable | Noto Sans SC Variable, Segoe UI Variable Text, Microsoft YaHei UI | 400 | Task titles, body copy, labels |
| Mono / metrics | Geist Mono Variable | Cascadia Code, Consolas, monospace | 400 | Counts, progress, timestamps, dates |

Chinese text always falls through to Noto Sans SC. Manrope and Inter have no CJK glyphs.

### Mono rules

`mono_for_code: false` · `mono_for_metrics: true`

Polaris has no code surfaces. Mono is a data texture: counts, progress, timestamps, dates. It never sets a full Chinese sentence.

### Type scale

| Token | Size | Line height | Letter spacing | Weight | Use |
|-------|------|-------------|----------------|--------|-----|
| `--text-display` | 34px | 1.15 | -0.02em | 600 | 今天, 设置, screen titles |
| `--text-heading` | 24px | 1.2 | -0.02em | 600 | Detail title, dialog title |
| `--text-subheading` | 18px | 1.3 | -0.01em | 600 | Empty state, card title |
| `--text-body` | 14px | 1.6 | 0 | 400 | Task titles, body copy |
| `--text-body-sm` | 13px | 1.55 | 0 | 400 | Notes, descriptions |
| `--text-caption` | 11px | 1.5 | 0 | 400 | Timestamps, metadata |
| `--text-label` | 11px | 1.4 | 0.06em | 600 | Section labels, micro-labels |

Rules:

- Chinese labels are never smaller than 11px.
- English uppercase labels may use 0.1em to 0.12em tracking; Chinese labels use 0.04em to 0.06em.
- Counts, dates, and times use `--font-mono` with `font-variant-numeric: tabular-nums`.
- No display font below 18px. Manrope's personality disappears at small sizes.

---

## 2. COLOR SYSTEM

### Light mode (day)

| Token | Hex | Role |
|-------|-----|------|
| `--background` | `#F4F3EF` | Page background |
| `--surface1` | `#FBFAF7` | Cards and floating panels |
| `--surface2` | `#E5E1D8` | Inputs and secondary surfaces |
| `--surface3` | `#D2CEC3` | Wells and tertiary surfaces |
| `--border` | `#E5E1D8` | Subtle borders |
| `--border-visible` | `#D2CEC3` | Inputs, active controls |
| `--text1` | `#14120F` | Primary text |
| `--text2` | `#5F5A51` | Secondary text |
| `--text3` | `#6B655B` | Tertiary text |
| `--text4` | `#8F897D` | Disabled text |
| `--accent` | `#0F766E` | Primary action |
| `--accent-subtle` | `#F0FDFA` | Accent tint |
| `--on-accent` | `#FFFFFF` | Text on accent |
| `--success` | `#0F766E` | Success |
| `--success-bg` | `#ECFDF5` | Success tint |
| `--warning` | `#B45309` | Warning and attention |
| `--warning-bg` | `#FFFBEB` | Warning tint |
| `--error` | `#BE123C` | Error and destructive |
| `--error-bg` | `#FFF1F2` | Error tint |
| `--star-a` | `#0F766E` | Star gradient start |
| `--star-b` | `#7C3AED` | Star gradient end |

### Dark mode (night)

| Token | Hex | Role |
|-------|-----|------|
| `--background` | `#080A0F` | Page background |
| `--surface1` | `#0D1018` | Cards and floating panels |
| `--surface2` | `#12161F` | Inputs and secondary surfaces |
| `--surface3` | `#1E2430` | Wells and tertiary surfaces |
| `--border` | `#1E2430` | Subtle borders |
| `--border-visible` | `#2A3140` | Inputs, active controls |
| `--text1` | `#E8ECF4` | Primary text |
| `--text2` | `#9AA4B2` | Secondary text |
| `--text3` | `#7A8494` | Tertiary text |
| `--text4` | `#5B6472` | Disabled text |
| `--accent` | `#5EEAD4` | Primary action |
| `--accent-subtle` | `#0A2A28` | Accent tint |
| `--on-accent` | `#07110F` | Text on accent |
| `--success` | `#5EEAD4` | Success |
| `--success-bg` | `#0A2A28` | Success tint |
| `--warning` | `#FBBF24` | Warning and attention |
| `--warning-bg` | `#451A03` | Warning tint |
| `--error` | `#FB7185` | Error and destructive |
| `--error-bg` | `#4C0519` | Error tint |
| `--star-a` | `#5EEAD4` | Star gradient start |
| `--star-b` | `#A78BFA` | Star gradient end |

### Contrast

- Light: text1 and text2 clear 7:1 on paper. text3 clears 4.5:1 on paper. Accent text uses brand.600, which clears 4.5:1 on paper.
- Dark: text1 and text2 clear 7:1 on ink. text3 clears 4.5:1 on ink. Accent text uses brand.300, which clears 4.5:1 on ink.
- Non-text controls (project dots, checkbox borders, switch tracks) need 3:1. Pastel project dots on paper get a 1px `--border-visible` ring and a slight darkening filter.
- Never use color as the only state signal. Completed tasks keep a checkmark and line-through; priority keeps a label or flag.

### Usage rules

- One accent per view. Teal is action and success. Amber is attention. Violet is the star and low priority.
- The brand gradient is allowed only in the star mark and the empty-state composition. The progress ring uses solid accent.
- Backgrounds are paper or ink. No pure black or pure white page surfaces.
- Transparent surfaces are overlays only, never content cards.

---

## 3. SPACING

8px base grid; 12px is the compact-control exception.

| Token | Value | Use |
|-------|-------|-----|
| `--space-2xs` | 2px | Optical adjustments |
| `--space-xs` | 4px | Icon-to-label gaps |
| `--space-sm` | 8px | Internal control padding |
| `--space-control` | 12px | Compact control gaps, task row padding |
| `--space-md` | 16px | Standard padding |
| `--space-lg` | 24px | Card padding, section spacing |
| `--space-xl` | 32px | Major section spacing |
| `--space-2xl` | 48px | Screen breathing room |
| `--space-3xl` | 64px | Large empty states |
| `--space-4xl` | 96px | Hero-only spacing |

---

## 4. RADII AND BORDERS

| Token | Value | Use |
|-------|-------|-----|
| `--radius-element` | 6px | Small controls, color swatches |
| `--radius-control` | 8px | Buttons, inputs, chips, switches |
| `--radius-component` | 12px | Task rows, quick add, toasts |
| `--radius-container` | 16px | Command palette, settings, reminder card |
| `--radius-pill` | 999px | Status pills, badges |

Borders:

- Cards and surfaces: 1px `--border`.
- Inputs: 1px `--border`, focus changes to `--accent`.
- Buttons: primary has no border; secondary and destructive use 1px `--border-visible`.
- Tags and chips: 1px `--border`.
- Modals and drawers: 1px `--border-visible`.

Task rows are never pills. Cards never exceed 16px radius.

---

## 5. ELEVATION

Polaris is a quiet, border-first system. Shadows are reserved for surfaces that float above the app.

| Level | Light | Dark | Use |
|-------|-------|------|-----|
| 0 | none | none | Task rows, inline surfaces |
| 1 | `0 8px 24px -18px rgba(20,18,15,.25)` | `0 8px 24px -18px rgba(0,0,0,.80)` | Small floating cards |
| 2 | `0 18px 50px -24px rgba(20,18,15,.30)` | `0 18px 50px -24px rgba(0,0,0,.80)` | Quick add, toast |
| 3 | `0 32px 80px -32px rgba(20,18,15,.35)` | `0 32px 80px -32px rgba(0,0,0,.85)` | Command palette, drawer, reminder |

No shadow on task rows. No glass on content. Mica, if used, is a titlebar-only experiment with a solid fallback.

---

## 6. MOTION

Personality: smooth. Calm transitions, no bounce on dense data.

| Type | Duration | Easing | Use |
|------|----------|--------|-----|
| Micro | 120ms | `cubic-bezier(0.2,0,0,1)` | Press, hover, toggle |
| Standard | 200ms | `cubic-bezier(0.2,0,0,1)` | Drawer, palette, view switch |
| Emphasis | 320ms | `cubic-bezier(0.22,1,0.36,1)` | Empty state, onboarding |

Springs:

- List: stiffness 420, damping 36.
- Sheet: stiffness 380, damping 40.
- Palette: stiffness 500, damping 40.

Rules:

- Animate one or two key elements per view. Do not animate every row.
- No overshoot on dense task lists.
- Respect reduced motion. Render the final state immediately.
- Loading spinners are the only continuous animation.

---

## 7. ICONOGRAPHY

### Observed style

| Attribute | Value |
|-----------|-------|
| Description | Lucide outline icons with a 1.75px stroke override, rounded caps, geometric-clean. The task checkbox check uses 2.2px. |
| Stroke weight | Regular, 1.75px |
| Corner treatment | Soft |
| Fill style | Outline |
| Form language | Geometric |
| Visual density | Minimal to balanced |

### Kit

- **Kit:** Lucide (`lucide-react`)
- **Weight:** 1.75px override; check 2.2px
- **Match:** High. Polaris already uses Lucide; the override is the brand's adjustment.
- **Rule:** One kit only. No mixing with Phosphor, Heroicons, or emoji.

### Sizes

| Context | Size |
|---------|------|
| Inline metadata | 10px |
| Buttons and rows | 14px |
| Navigation | 16px |
| Large empty-state icon | 20px |

### Color rule

Icons inherit `--text2` by default. Active navigation icons and reminder bells use `--accent`. Never color an icon differently from the text it describes unless the color carries a semantic state.

### Do not

- Use emoji as a structural icon.
- Use filled icons except the completed check.
- Use an icon-only control without an accessible name.
- Leave decorative icons visible to screen readers; use `aria-hidden="true"`.