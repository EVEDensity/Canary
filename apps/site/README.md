# Canary website

Bilingual product website with an interactive architecture preview, verification example and workspace tour. Built with static HTML, CSS and JavaScript.

## Preview and build

```bash
pnpm site:dev
pnpm site:build
pnpm site:preview --port 4321
```

The development preview uses port 4320. Rebuild and refresh after editing. Output is generated in `apps/site/dist/`; relative asset paths support both `/` and `/Canary/`.

## GitHub Pages

1. Select **GitHub Actions** in repository **Settings → Pages**.
2. Set the repository variable `CANARY_PAGES_ENABLED` to `true`.
3. Run the **Canary website** workflow on `main`.

The project URL is `https://evedensity.github.io/Canary/`. Navigation links to the Canary repository.

## Interaction and accessibility

- English is the default; switching language preserves selections and results.
- Desktop sections use cover, horizontal and circular reveal transitions. Header links navigate directly to each section; mobile devices use natural scrolling.
- Each transition has a distinct acceleration curve; horizontal motion adds a brief visual overshoot while document scrolling stays stable.
- The architecture example highlights direct relationships and corresponding evidence.
- The verification example compares a retained failure with a linked deterministic rerun.
- The workspace tour uses recorded product screenshots with focus and zoom controls.
- Finite animations honor reduced-motion preferences and cancel when superseded.
- Keyboard navigation and responsive layouts are supported.

The website is independent of the CLI and report server. It uses bundled assets and no additional runtime dependencies. Distributed assets retain their license notices.
