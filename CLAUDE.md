# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

This repo is the public marketing/landing site for **MémoTruck**, a fleet-management product for truck drivers and fleet managers ("chefs de parc"). The entire site is a single static file:

- `index.html` — the complete site: inline `<style>`, inline body markup, inline `<script>`. No other source files exist in this repo.

There is no package.json, build tool, bundler, test suite, or CI config. The site is not a SPA framework project — it's hand-authored static HTML/CSS/JS meant to be deployed as-is (hosting is Vercel, per the "Mentions Légales" modal in the page).

The MémoTruck *product* (driver app + admin panel) lives in separate repositories/deployments, not here:
- Driver app: https://memotruck-app-dev.vercel.app/
- Admin panel: https://memo-truck-web-admin.vercel.app/

Those apps use Supabase as their backend (mentioned in the legal modals), but this repo has no backend code or dependency on Supabase itself — it's purely the marketing page linking out to them.

## Development workflow

There is no build step. To preview changes, simply open `index.html` in a browser, or serve the directory locally, e.g.:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000/`. There is no linter, formatter, or test command configured — validate changes by visually checking the page in a browser (the page is heavily animation/scroll-effect driven, so a visual check matters more than reading the diff).

## File structure of `index.html`

The single file is organized into three large chunks, in order:

1. **`<head>` / main `<style>` block (~lines 11–881)** — all CSS for the page, including a `:root` block of design tokens (~line 90) and section-by-section rules marked with `/* ════ SECTION NAME ════ */` banner comments (e.g. `NAV`, `HERO`, `FOOTER LÉGAL`, `MODALES LÉGALES`). A second small `<style>` block (~lines 971–973) holds responsive overrides for the hero phone illustration.
2. **`<body>` markup (~lines 883–1360)** — the page content, split into `<section id="...">` blocks in scroll order:
   - `#hero`, `#problem`, `#features`, `#how`, `#screenshots`, `#access`, `#cta`
   - followed by the footer and four legal modals: `#modal-cgu`, `#modal-cgv`, `#modal-mentions`, `#modal-rgpd`.
3. **`<script>` block at the end of the file** — vanilla JS, no dependencies, doing four things:
   - `IntersectionObserver`-based scroll-reveal (toggles `.on` on `.reveal` elements)
   - smooth scroll for in-page `a[href^="#"]` anchors
   - the legal modal open/close system (`openModal(id)` / `closeModal()`, keyed off `#modal-<id>` element IDs, dismissible via the `#modal-overlay` backdrop click or Escape key)
   - the mobile nav burger toggle (`#burger`)

## Key conventions

- **Content is in French.** All copy, comments, and legal text are French; keep new content consistent with that.
- **Section anchors drive navigation.** The nav links (`#problem`, `#features`, `#how`, `#screenshots`, `#access`) and footer links must match existing `<section id="...">` values — don't rename a section id without updating every link to it.
- **The legal modal pattern is copy-paste-based.** Each modal is a `<div id="modal-<name>" class="legal-modal" style="display:none;">` with a `<button class="modal-close" onclick="closeModal()">`. `closeModal()` hard-codes the modal id list (`['cgu','cgv','mentions','rgpd']`), so adding a new modal requires updating that array in the script block too.
- **Images are inlined as base64 `data:` URIs** directly in the HTML (favicon and other visual assets) rather than referenced as separate files — this is why some lines in the file are tens of thousands of characters long. When editing near these lines, avoid dumping/rewriting the base64 blob unnecessarily; target surrounding markup/attributes precisely.
- **Styling uses CSS custom properties** defined once in `:root` (colors like `--cyan`, `--bg`, `--muted`; font stack `--head`). Reuse these variables instead of hardcoding new colors.
- **No JS framework or build pipeline** — new interactivity should be added as plain vanilla JS appended to the existing `<script>` block, consistent with the existing style (small IIFEs / top-level `document.querySelectorAll` + event listeners, `// ── SECTION ──` comment banners).
