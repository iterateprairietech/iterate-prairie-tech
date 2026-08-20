# AGENTS.md

## Stack

- Astro 7, static output (`astro.config.mjs` is empty `defineConfig({})`; no SSR
  adapter or integrations installed yet). ESM project (`"type": "module"`).
- TypeScript strict — `tsconfig.json` extends `astro/tsconfigs/strict`.
- Requires Node >= 22.12.0 (`package.json` `engines`).

## Commands

- `npm run dev` — dev server on port 4321. **Prefer background mode** so it
  doesn't block the shell: `npx astro dev --background`, then manage with
  `npx astro dev stop | status | logs [--follow]`.
- `npm run build` — production build to `dist/` (verifies the project compiles).
- `npm run preview` — preview the built site.
- No `lint` or `typecheck` script is configured. For full TS type-checking run
  `npx astro check` — on first use it offers to install `@astrojs/check`.

## Generated / ignored

- `.astro/` holds generated types (referenced from `tsconfig.json`); `dist/`,
  `node_modules/`, and `.env*` are all gitignored. Don't commit them.
- Add integrations via `npx astro add <name>` (e.g. `tailwind`, `react`); this
  edits `astro.config.mjs` and installs deps.

## Motion / smooth scroll

- Smooth scrolling uses **Lenis** wired into GSAP's ticker (`src/layouts/Layout.astro`).
  GSAP's premium `ScrollSmoother` is NOT used (the free `gsap` package omits it);
  Lenis is the substitute. Do not switch to ScrollSmoother without a Club license.
- Each component owns its own `<script>` (bundled by Vite) that imports
  `gsap` + `gsap/ScrollTrigger`. Scroll-reveal elements are tagged `data-anim`
  and hidden via `:global(html.js) [data-anim]{opacity:0}` (the `js` class is set
  synchronously in the Layout head) so there's no flash before JS runs. Always
  provide a `prefers-reduced-motion` branch that reveals them.
- In-page anchor links (`a[href^="#"]`) are delegated globally in the Layout via a
  custom `ipt:scrollto` event → `lenis.scrollTo`. Don't add per-link scroll handlers;
  just use plain anchors and they'll smooth-scroll.

## Line endings

`.gitattributes` sets `* text=auto` (LF normalization on commit). On Windows the
working tree may use CRLF; don't commit line-ending-only fixes as part of
unrelated changes.
