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

The page uses Canary's warm paper, graphite and coral palette. An original layered signal map lets visitors step through detection, source location and linked verification. This is a labeled interactive example; the workspace preview is a recorded product screenshot.

English is the default. The language toggle updates copy, accessible labels and screenshots in place. OS tabs, command copying, screenshot enlargement and mobile navigation support keyboard input. Reduced motion preferences disable decorative motion.

Design references informed the hierarchy and interaction, with an original implementation:

- [Linear](https://linear.app/): product workflow and interface presentation.
- [Resend](https://resend.com/): developer focused copy and interactive examples.
- [Raycast](https://www.raycast.com/): commands and action driven storytelling.
- [basement's Next.js Conf case study](https://basement.studio/showcase/nextjs-conf-raising-the-bar-again): spatial interaction and the Awwwards recognized conference experience.
