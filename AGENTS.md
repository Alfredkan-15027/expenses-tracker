# AGENTS.md — rules for AI coding agents (Codex, etc.)

This repository is **Expenses Tracker**, a private, single-user PWA. The owner's financial data lives only
on their phone. Code and logic are maintained separately; **AI agents in this repo work on visual design only**.

## Hard boundary — read before doing anything

You may create / edit **only** these paths:

| Allowed | What for |
|---|---|
| `styles/*.css` (`tokens.css`, `base.css`, `components.css`, `screens.css`) | All visual design: colors, type, spacing, radii, glass, shadows, motion |
| `assets/icons/*.svg`, `assets/icons/*.png` | Glyph sprite and app icons (same file names, same symbol ids) |
| `docs/codex-proposals.md` | Write down any change you think is needed outside the allowed paths |

Everything else is **read-only** for you, including but not limited to:
`src/**` (all JavaScript), `index.html`, `sw.js`, `manifest.webmanifest`, `tests/**`, `scripts/**`,
`.github/**`, `package.json`, `AGENTS.md`, `CODEX_DESIGN.md`, `README.md`, `docs/*` (except `codex-proposals.md`).

- Do not rename, delete or add files outside the allowed paths.
- Do not rename CSS class names or icon ids — the JavaScript depends on them and you cannot change the JavaScript.
- Do not add external resources: no web fonts, CDNs, remote images, `@import`, or `url(http…)`.
- Do not add scripts or event attributes to SVG files.
- Do not weaken the privacy rules in the styles: the lock screen (`.lock-screen`) must stay fully opaque and
  `html.is-locked #app` / `html.is-concealed #app` must stay hidden.

## Required checks before you finish

```bash
npm test
npm run check:security
node scripts/check-codex-scope.mjs
```

All three must pass. If the scope check fails, revert the out-of-scope changes and describe the need in
`docs/codex-proposals.md` instead.

## Design brief

Read **`CODEX_DESIGN.md`** for the design direction (iOS 27 Liquid Glass), the component / class inventory,
states, accessibility requirements and how to preview with demo data.
