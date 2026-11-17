# DESIGN.md — Trippie Editorial Web Contract

This contract governs the public landing page (`/`) and any future public marketing surfaces for **Trippie**. The authenticated three-panel workspace (`/home`, `/overview`, `/trips/*`, `/settings`) keeps the existing shell and theme switcher (`atlas` / `cartographer`).

## 1. Palette

Neutrals carry the entire page frame; full colour and the brand accent appear strictly inside browser-framed product screenshots. All text/surface pairings meet WCAG AA and APCA Lc 75+.

| Token | Value | Role |
|---|---|---|
| Page ground | `#f5f4f0` | Primary alternating section background (Header, Logo Cloud, Features, Testimonials, Pricing, Footer) |
| Alternate ground / Inset surface | `#ecebe8` | Alternating section background (Hero, Process, FAQ) and inset cards (Pricing, supporting Quotes) |
| Inverse ground | `#141314` | Closing full-width banner |
| Primary ink | `#000000` | Headings, key numerals, active borders on light surfaces |
| Secondary ink | `#373737` | Body copy, navigation links |
| Muted ink | `#505050` | Captions, metric labels, metadata |
| Inverse ink | `#fcfcfd` | Labels on `#131313` / `#141314` surfaces |
| Hairline | `#d6d5d2` | Dividers, secondary button borders, browser-frame borders |
| Primary action fill | `#131313` | Primary buttons (with `#fcfcfd` label) |
| Product-only accent | `#ffc61a` | Route arcs, map pins, and golden-hour badges inside product screenshots only |

## 2. Typography

- **Display / Headlines**: `EB Garamond` (weight `500`), sentence case, tight tracking (`-0.025em`), line-height `1.03–1.14`. No italicised or colour-accented emphasis words inside headlines.
  - Hero `<h1>` size: `83px` at `1440px` (`~5.2×` body), `62px` at `390px`.
- **Body / Controls**: `Host Grotesk` (weights `400`, `500`, `600`), `16px` base body copy with `1.55` line-height, line length kept under `72ch`.
- Avoid all-caps eyebrow labels, decorative middot chains, or unprompted arrow glyphs in prose.

## 3. Layout, Spacing & Corners

- **Container**: `1200px` max width with `24px` (`px-6`) outer page margin on all viewports.
- **Section rhythm**: Roomy band padding (`128px` top / `85px` bottom at `1440px`; `85px` top / `64px` bottom at `390px`). Sections alternate `#f5f4f0` and `#ecebe8` grounds without horizontal section divider lines.
- **Corners**: Soft `8px` radius on all surfaces, cards, browser frames, inputs, and buttons.
- **Cards**: Inset `#ecebe8` surfaces with quiet `#d6d5d2` borders (`1px`), no drop-shadow clutter on page cards.

## 4. Imagery & Framing

- Every product demonstration renders inside a clean `#ecebe8` / `#d6d5d2` light browser frame (`8px` corners, top chrome bar with three window dots and a quiet pill bar).
- Vivid cartographic blues, greens, sunset warmths, and `#ffc61a` route paths live exclusively inside these browser frames.

## 5. Motion & Static Contract

- Keep motion restrained to direct user actions (mobile menu drawer, FAQ accordion expand/collapse, link hover states), respecting `prefers-reduced-motion`.
- Static landing (`/`) remains 100% static at build (`prerender.ts`): zero `/api/auth/` requests and zero `/ws/` WebSockets.
