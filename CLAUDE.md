# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

This repo is the public marketing/landing site for **MémoTruck**, a fleet-management product for truck drivers and fleet managers ("chefs de parc"). The page itself is a single static file:

- `index.html` — the complete site: inline `<style>`, inline body markup, inline `<script>`.
- `assets/` — binary assets that are impractical to inline as base64 (a vendored copy of Three.js, a 3D phone model, and a real app screenshot). See "3D cinematic section" below.

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
2. **`<body>` markup** — the page content, split into `<section id="...">` blocks in scroll order:
   - `#hero`, `#cinema` (3D cinematic reveal), `#problem`, `#features`, `#how`, `#screenshots`, `#pricing`, `#access`, `#cta`
   - a fixed right-edge chapter nav (`#chapter-nav`) that scrollspies these sections on desktop
   - followed by the footer and four legal modals: `#modal-cgu`, `#modal-cgv`, `#modal-mentions`, `#modal-rgpd`.
3. **`<script>` block at the end of the file** — vanilla JS, no framework, doing (among other things):
   - `IntersectionObserver`-based scroll-reveal (toggles `.on` on `.reveal` elements)
   - smooth scroll for in-page `a[href^="#"]` anchors
   - the legal modal open/close system (`openModal(id)` / `closeModal()`, keyed off `#modal-<id>` element IDs, dismissible via the `#modal-overlay` backdrop click or Escape key)
   - the mobile nav burger toggle (`#burger`)
   - chapter-nav scrollspy, background parallax layers (`.parallax-layer`), and the `#cinema` scroll-driven phase controller
4. **A separate `<script type="module">` block** (see "3D cinematic section" below) that lazy-loads the real 3D phone.

### 3D cinematic section (`#cinema`)

Between the hero and "Le problème", `#cinema` is a pinned scroll section (~300vh tall, `position:sticky` inner stage) that plays a scroll-scrubbed sequence: the phone rotates into view, splits into body/screen/camera-cluster pieces with feature chips flying out, then the camera dives through the screen (flash) before releasing into the rest of the page.

- The visual is a **real glTF model** (`assets/models/gp5.glb`, converted from an OBJ via `obj2gltf`), rendered with a vendored copy of **Three.js** (`assets/vendor/three/`) — not a CDN dependency, and not loaded eagerly. An `<script type="importmap">` in `<head>` maps the bare `"three"` specifier to `assets/vendor/three/three.module.min.js`.
- A dedicated `<script type="module">` near the end of the file lazy-loads Three.js + `GLTFLoader` + the model only once an `IntersectionObserver` sees `#cinema` approaching the viewport, and exposes `window.__cinema3dUpdate(state)`, which the main scroll controller calls every frame with the current phase values (`introRotY`, `introRotX`, `intro`, `explode`, `dive`).
- The model's "screen" mesh gets a real app screenshot (`assets/images/app-screen.jpg`) applied as its texture via `THREE.TextureLoader`; note `tex.flipY = false` is required — this specific mesh's UV mapping renders upside down otherwise.
- A CSS-only phone (`#cinema-fallback-phone`, reusing the same `.ph2-*` classes as the hero mockup) is the default/fallback: it stays visible until the 3D module finishes loading (`fallback.style.display = 'none'`), and is the *only* thing shown under `prefers-reduced-motion: reduce` — the whole module bails out early in that case, so WebGL/Three.js/the model are never fetched at all for those users.
- If you need to re-derive the model's part groupings or fix orientation again, the fastest path is a throwaway test HTML at the repo root (not committed) that imports the same vendored Three.js + GLTFLoader, logs `mesh.name` for every node, and screenshots the result — see git history for the exact pattern used to debug this the first time.

## Key conventions

- **Content is in French.** All copy, comments, and legal text are French; keep new content consistent with that.
- **Section anchors drive navigation.** The nav links (`#problem`, `#features`, `#how`, `#screenshots`, `#pricing`, `#access`), footer links, and the `#chapter-nav` scrollspy dots must match existing `<section id="...">` values — don't rename a section id without updating every link to it.
- **The legal modal pattern is copy-paste-based.** Each modal is a `<div id="modal-<name>" class="legal-modal" style="display:none;">` with a `<button class="modal-close" onclick="closeModal()">`. `closeModal()` hard-codes the modal id list (`['cgu','cgv','mentions','rgpd']`), so adding a new modal requires updating that array in the script block too.
- **Images are inlined as base64 `data:` URIs** directly in the HTML (favicon and other visual assets) rather than referenced as separate files — this is why some lines in the file are tens of thousands of characters long. When editing near these lines, avoid dumping/rewriting the base64 blob unnecessarily; target surrounding markup/attributes precisely.
- **Styling uses CSS custom properties** defined once in `:root` (colors like `--cyan`, `--bg`, `--muted`; font stack `--head`). Reuse these variables instead of hardcoding new colors.
- **No JS framework or build pipeline** — new interactivity should be added as plain vanilla JS appended to the existing `<script>` block, consistent with the existing style (small IIFEs / top-level `document.querySelectorAll` + event listeners, `// ── SECTION ──` comment banners). The one exception is Three.js, vendored (not CDN) for the `#cinema` 3D model — it's loaded lazily and only for that section; don't reach for it (or any other library) for effects plain CSS/JS can already do, which is how everything else on this page works.
