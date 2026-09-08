# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

This repo is the public marketing/landing site for **MémoTruck**, a fleet-management product for truck drivers and fleet managers ("chefs de parc"). The page itself is a single static file:

- `index.html` — the complete site: inline `<style>`, inline body markup, inline `<script>`.

There is no package.json, build tool, bundler, test suite, or CI config. The site is not a SPA framework project — it's hand-authored static HTML/CSS/JS meant to be deployed as-is (hosting is Vercel).

The MémoTruck *product* (driver app + admin panel) lives in separate repositories/deployments, not here:
- Driver app: https://memotruck-app-dev.vercel.app/
- Admin panel: https://memo-truck-web-admin.vercel.app/

There is no backend and no database in this repo. The contact form submits directly to **FormSubmit.co** (`https://formsubmit.co/ajax/contact@memotruck.fr`), a third-party form-to-email relay — no server code to host or maintain.

## Development workflow

There is no build step. To preview changes, simply open `index.html` in a browser, or serve the directory locally, e.g.:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000/`. There is no linter, formatter, or test command configured — validate changes by visually checking the page in a browser (the page is heavily animation/scroll-effect driven, so a visual check matters more than reading the diff).

## File structure of `index.html`

The single file is organized into three chunks, in order:

1. **`<head>` / `<style>` block** — all CSS for the page: a `:root` block of design tokens (colors, fonts, radius, easing) and section-by-section rules marked with `/* ════ SECTION NAME ════ */` banner comments (`RESET/ROOT`, `REVEAL`, `NAV`, `HERO`, `MARQUEE`, `FEATURES`, `CONTACT`, `FOOTER`, `REDUCED MOTION`).
2. **`<body>` markup** — the page content, split into `<section id="...">` blocks in scroll order: `#hero`, `#marquee`, `#fonctionnalites`, `#contact`, followed by the `<footer>`. A fixed `#navbar` header sits above all sections.
3. **`<script>` block at the end of the file** — vanilla JS, no framework, doing:
   - injecting the marquee's repeated item list into `#marquee-track`
   - `IntersectionObserver`-based scroll-reveal (toggles `.on` on `.reveal` elements)
   - a scroll listener driving the hero background parallax (translateY/opacity on `#hero-bg`)
   - a `mousemove` listener driving the hero product-visual tilt effect (`#hero-visual`, CSS `rotateX`/`rotateY`)
   - the contact form submit handler — `fetch('https://formsubmit.co/ajax/contact@memotruck.fr', …)`, swaps `#contact-form` for `#contact-success` on success, shows `#contact-error` on failure

## Key conventions

- **Content is in French.** All copy is French; keep new content consistent with that.
- **Section anchors drive navigation.** The nav links (`#fonctionnalites`, `#contact`), footer links, and hero CTAs must match existing `<section id="...">` values — don't rename a section id without updating every link to it.
- **Styling uses CSS custom properties** defined once in `:root` (`--bg`, `--cyan`, `--muted`, `--border`, etc.; font stack `--display`/`--body`/`--mono`). Reuse these variables instead of hardcoding new colors.
- **Animations are intentionally always-on**, regardless of the visitor's `prefers-reduced-motion` preference — a deliberate choice for this site made after animations appeared to "not work" for a tester whose browser reported `prefers-reduced-motion: reduce`. Don't gate new animations behind that media query or a JS `matchMedia` check unless explicitly asked to reintroduce that accommodation.
- **The contact form has no backend.** It's a plain `<form>` posting to FormSubmit.co, intercepted by JS to submit via `fetch` so the page can swap in a styled success state instead of redirecting off-site. `contact@memotruck.fr` must click FormSubmit's one-time activation email before the first real submission will be delivered — test submissions before that will silently fail to arrive (though the on-page success/error state doesn't depend on that activation).
- **No JS framework or build pipeline** — new interactivity should be added as plain vanilla JS appended to the existing `<script>` block, consistent with the existing style (small IIFEs, `// ── SECTION ──` comment banners). Don't reach for a library for effects plain CSS/JS can already do, which is how everything else on this page works.
- Hero/feature photography is linked directly from Unsplash/Pexels CDN URLs rather than downloaded/inlined — keep that pattern for new stock imagery to avoid bloating the single HTML file.

## Delivering multiple generated images to the user on mobile (e.g. Instagram carousel assets)

When the user needs to save several generated images (renders, carousel slides, etc.) from their phone, a plain `SendUserFile`/base64-`<img>`-long-press page renames every file to the same generic "Téléchargement.PNG" on Android/Chrome, overwriting all but the last one. The working fix, validated end-to-end with the user:

1. Publish an Artifact with `capabilities: {downloads: true}`.
2. Embed each image as a base64 `data:` URI in an `<img>`, with one button per image calling `await (await window.claude.use('downloads')).save({filename, data: blob})` — this gives each file a real, distinct filename via a native save confirmation.
3. **Never `fetch()` the image's own `data:` URI to get the Blob** — it fails with "Failed to fetch" in this runtime. Instead decode the base64 payload directly: `atob()` the payload, build a `Uint8Array`, wrap it in `new Blob([bytes], {type: mime})`.
4. **Space out saves** — calling `downloads.save()` back-to-back (e.g. 6 slides tapped quickly) trips a rate limit ("too many save prompts; try again shortly") on roughly the 6th rapid call. If a save fails with that message, just wait ~30-60s and retry that one file; it's not a bug, it's the platform's one-prompt-at-a-time throttle.
5. Show a persistent on-page status log (not `alert()`) of each step/result — `alert()`/modals are unreliable inside the sandboxed artifact iframe, so silent failures are otherwise undebuggable.
