# Canary website

The bilingual product landing page. Static HTML, CSS, and JavaScript; no additional runtime dependencies.

## Preview

From the repository root:

```bash
pnpm site:dev
```

Open `http://127.0.0.1:4320/`. After editing, rebuild and refresh the page.

```bash
pnpm site:build
pnpm site:preview --port 4321
```

The scripts also work directly with Node:

```bash
node apps/site/scripts/build.mjs
node apps/site/scripts/serve.mjs --port 4321 --base /Canary/
```

## Build

Output is `apps/site/dist/`. The build copies the page, optional `apps/site/assets/`, and existing dashboard images and the Inter font from their original repository locations. Font and icon licenses ship with the output. Asset paths are relative, so the same build works at `/` and GitHub Pages `/Canary/`.

## GitHub Pages

The `Canary website` workflow builds changes to the website and its shared assets. Deployment is opt-in:

1. In repository **Settings → Pages**, select **GitHub Actions** as the publishing source.
2. Add an Actions repository variable `CANARY_PAGES_ENABLED` with value `true`.
3. Run **Actions → Canary website → Run workflow** on `main`.

After enabling, relevant pushes to `main` also deploy. Pull requests only build. The expected project URL is `https://evedensity.github.io/Canary/`. A custom domain can use the same build.

This app is independent of the CLI and report server. Product navigation links to [EVEDensity/Canary](https://github.com/EVEDensity/Canary).

## Design and interaction

The page helps developers understand Canary, inspect the product, try verification, and install it. The reading order is value proposition → connected workflow → actual workspace → repair playground → installation → FAQ. The name's early-warning story stays in the footer.

### Design specification

- **Layout:** 1240px maximum content width; 48px desktop gutters, 32px tablet gutters, 20px phone gutters. Hero uses a 5/7 split with a 48–64px gap. Main sections are separated by 96px, or 64px on phones. Header height is 72px, or 68px on phones.
- **Palette:** paper `#f7f5ef`, surface `#fffdf8`, graphite `#292c25`, secondary text `#686d60`, coral accent `#d97456`, text/link coral `#a64d36`, success `#526c43`. Regular coral is reserved for graphic accents. Graphite and secondary text exceed 4.5:1 on paper.
- **Typography:** bundled variable Inter with Chinese system fallbacks. Hero 72px/1.05, section headings 44px/1.12, introductory copy 18px/1.6, body 16px/1.6, helper and code 14px/1.6. Compact map metadata uses 12–13px. On phones the hero is 44px and section headings 32px.
- **Components:** cards use 16–22px radii and 18–24px padding; main buttons are at least 48px high, other controls at least 44px. Controls expose selected, hover, focus, disabled, and loading states. Errors use text and markers alongside color.
- **Motion:** finite hero arrival uses 80ms text and 90ms card staggering. Stage indicator slides in 200ms; evidence enters in 180–220ms. Selecting a map node sends a 600ms signal along declared relationships, with a 4px node lift. Desktop pointer tilt is limited to ±3°. Patch highlighting lasts 300ms; verification sends a 500ms signal to the result, followed by a 240ms result arrival and success mark. Screenshot focus uses a 300ms transform transition, buttons respond in 150ms, copying in 180ms, and mobile menu entry in 180ms. Rapid actions cancel superseded motion; locale changes preserve state without replaying the hero. Hidden documents cancel active motion and pause the walkthrough. Reduced-motion preferences remove decorative transitions and perspective transforms, including when changed during a session.
- **Responsive behavior:** hero becomes one column at 980px; application panels stack at 760px; the compact map becomes readable vertical layers at 520px. Code and screenshot navigation scroll inside their own containers, rather than widening the page.
- **Implementation:** layout, styling, and spatial presentation use CSS. JavaScript handles selected nodes, locale, deterministic assertions, keyboard navigation, clipboard, and preview state. No WebGL, background animation loop, external font request, or new runtime dependency is required.

English is the default. The language toggle updates copy, accessible labels and screenshots in place while preserving selections and verification results. Reduced motion preferences disable decorative motion.

- **Signal map:** Detect / Locate / Verify are the main controls. View settings progressively disclose 2D/3D and the walkthrough. Inspect six files and their direct relationships; manual selection stops the walkthrough. This is a labeled illustrative preview.
- **Verification playground:** select the original code or repair patch, run a fixed deterministic checkout assertion, inspect error evidence, and compare the linked rerun with the original failure. Test input is folded by default; actions sit beside the source. This browser example does not execute a visitor's project or call an AI model.
- **Workspace tour:** four compact tabs highlight overview, architecture, trends and history in an actual product screenshot; the enlarged preview supports 100%, 125% and 150% zoom.
- **Accessible navigation:** tabs support arrow keys and Home/End, buttons support keyboard input, and mobile navigation, command copying and reset actions provide explicit feedback.

Design references informed the hierarchy and interaction, with an original implementation:

- [Linear](https://linear.app/): product workflow and interface presentation.
- [Resend](https://resend.com/): developer focused copy and interactive examples.
- [Raycast](https://www.raycast.com/): commands and action driven storytelling.
- [basement's Next.js Conf case study](https://basement.studio/showcase/nextjs-conf-raising-the-bar-again): spatial interaction and the Awwwards recognized conference experience.

Motion helpers live in `motion.js` and component styling in `motion.css`. CSS handles hover and entry effects; the Web Animations API handles interruptible state feedback. Screenshot focus animates a transform between previous and next bounds. Animated signals depict declared direct relationships without inferring new dependencies. Verification feedback follows the actual deterministic result and retains the original failure.
