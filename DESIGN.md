# DESIGN.md — Trippie Editorial Design Contract

This contract governs both the public landing page (`/`) and the collaborative workspace (`/home`, `/overview`, `/trips/*`, `/settings`) for **Trippie**.

## 1. Palette

Neutrals carry the editorial frame; the `#ffc61a` brand accent appears inside product imagery and as the dark-mode focus/active accent. All text/surface pairings meet WCAG AA and APCA Lc 75+.

| Token | Light (`/`, `cartographer`) | Dark (`atlas` default) | Role |
|---|---|---|---|
| Page / Panel ground | `#f5f4f0` | `#141314` / `#1a1918` | Primary surface background |
| Alternate / Inset card | `#ecebe8` | `#22211f` | Alternating bands and cards |
| Primary ink | `#000000` | `#f5f4f0` | Headings, active controls |
| Secondary / Muted ink | `#373737` / `#505050` | `#aba8a1` | Body copy, timeline metadata |
| Primary action | `#131313` (label `#fcfcfd`) | `#ffc61a` (label `#131313`) | Primary CTAs |
| Hairline border | `#d6d5d2` | `rgba(214,213,210,0.16)` | Hairlines, secondary button borders |
| Brand / Golden-hour accent | `#ffc61a` (product only) | `#ffc61a` | Route lines, golden-hour pins, active indicators |

## 2. Typography

- **Display / Headlines**: `EB Garamond` (weight `500`), sentence case, tight tracking (`-0.025em`), line-height `1.03–1.14`. No italicised or colour-accented emphasis words inside headlines.
  - Landing Hero `<h1>`: `83px` at `1440px`, `62px` at `390px`.
- **Body / UI Controls**: `Host Grotesk`, `16px` on `/` and `14px` in the workspace UI.

## 3. Restraint, Pill Reduction & Mobile Rules

- Avoid decorative `rounded-full` pill clusters on workspace metadata; present dates, access roles, and hotel details as quiet hairline metadata or `4px` structural tags (`rounded-[4px]`). Reserve `rounded-full` for sequence markers (`1`, `2`, `3`) and avatars.
- Landing page (`/`) stays strictly factual: no pricing/subscription tiers, no fabricated usage metrics, logos, or testimonials.
- Workspace views must remain usable at `375px–430px` (`100dvh` height, horizontal scroll on tab/date strips, `max-h-[90dvh]` modals, mobile timeline/map switching).
- Static landing (`/`) executes zero `/api/auth/` requests and zero `/ws/` WebSockets (`prerender.ts`).
