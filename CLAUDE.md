# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

This repo is the marketing/landing site for **MémoTruck**, a fleet-management product for truck drivers and fleet managers ("chefs de parc"). It is a two-part app:

- `frontend/` — a Create React App (via CRACO) single-page site: Tailwind CSS, Framer Motion for animations, Lenis for smooth scroll, Sonner for toasts. No routing library — it's a single scrolling landing page assembled from section components.
- `backend/` — a FastAPI service exposing a small `/api` surface (currently just the contact-request endpoint), backed by MongoDB via Motor (async driver).

The MémoTruck *product* (driver app + admin panel) lives in separate repositories/deployments, not here:
- Driver app: https://memotruck-app-dev.vercel.app/
- Admin panel: https://memo-truck-web-admin.vercel.app/

## Development workflow

### Frontend (`frontend/`)

```bash
cd frontend
yarn install
yarn start   # dev server, http://localhost:3000
yarn build   # production build to frontend/build
```

- Config: `REACT_APP_BACKEND_URL` in `frontend/.env` (defaults to `http://localhost:8001`) — the base URL the frontend calls for API requests (`${REACT_APP_BACKEND_URL}/api/...`).
- `@/*` imports resolve to `frontend/src/*`. This alias is NOT natively supported by `react-scripts`; it's wired up via `craco.config.js` (webpack alias) + `jsconfig.json` (editor/IDE resolution). Both must stay in sync if the alias ever changes. The npm scripts run through `craco` (`craco start` / `craco build`), not `react-scripts` directly.
- Tailwind is pinned to v3 (`tailwind.config.js`, `postcss.config.js`, `@tailwind base/components/utilities` in `src/index.css`) — do not upgrade to Tailwind v4 without rewriting the config to the v4 CSS-first format.

### Backend (`backend/`)

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --reload --port 8001
```

- Config: `backend/.env` — `MONGO_URL`, `DB_NAME`, `CORS_ORIGINS`.
- Requires a reachable MongoDB instance at `MONGO_URL` for the `/api/contact` endpoints to work (health check at `/api/health` works without one, since Motor connects lazily).

There is no test suite or CI config configured yet for either half.

## File structure

### `frontend/src/`

- `index.js` / `index.css` — app entrypoint; `index.css` holds the Tailwind directives, Google Fonts import, CSS custom properties (`:root`), and all one-off animation/utility classes (`.grain-overlay`, `.marquee-track`, `.radar-dot`, `.scanline`, `.text-outline`) used across sections.
- `App.js` — top-level layout: initializes Lenis smooth scroll, renders `Navbar` + the section components in order + `Footer`, mounts the Sonner `Toaster`. `scrollTo(target)` is passed down to children for in-page navigation (anchors or Lenis targets).
- `App.css` — minimal, just the `.App` container background.
- `components/landing/` — one component per landing-page section, in scroll order:
  - `Navbar.jsx` — fixed header, scroll-triggered entrance, in-page nav buttons.
  - `Hero.jsx` — headline, mouse-parallax product visual, scroll-linked background parallax (`useScroll`/`useTransform` from Framer Motion).
  - `Marquee.jsx` — infinite CSS-animated scrolling strip of feature/document keywords.
  - `Features.jsx` — three numbered "chapters" (alerts, fleet tracking, compliance), each with scroll-reveal animations.
  - `Contact.jsx` — the demo-request form; posts to `${REACT_APP_BACKEND_URL}/api/contact` via axios, shows a success state in place of the form, uses Sonner for toast feedback.
  - `Footer.jsx` — footer nav + legal line.

### `backend/`

- `server.py` — single-file FastAPI app. All routes are mounted on an `/api`-prefixed `APIRouter` (required — do not add routes directly to `app` without the prefix, since the frontend and any reverse proxy assume everything lives under `/api`). Defines `ContactRequestCreate` (input, validated) and `ContactRequest` (stored/returned, adds `id` + `created_at`), and `POST /api/contact` / `GET /api/contact` against the `contact_requests` Mongo collection.

## Key conventions

- **Content is in French.** All copy is French; keep new content consistent with that.
- **`data-testid` attributes are present throughout** the landing components (e.g. `hero-cta-demo`, `contact-form`, `contact-submit-button`) — preserve/extend these when editing markup, they're the hook for any future UI testing.
- **Section anchors drive navigation.** `#fonctionnalites` and `#contact` are real section ids used by `Navbar`, `Hero`, and `Footer` for in-page scrolling via `onNavigate`. Don't rename a section id without updating every caller.
- **Animation style**: Framer Motion `initial`/`whileInView`/`animate` with a shared `EASE = [0.16, 1, 0.3, 1]` cubic-bezier constant, repeated per-file (not centralized) — match this constant and the `reveal` variant pattern (`initial`/`whileInView`/`viewport`/`transition`) already used in `Features.jsx`/`Contact.jsx` when adding new scroll-reveal content.
- **Styling uses Tailwind + CSS custom properties** for the shadcn-style tokens (`--background`, `--foreground`, `--border`, `--input`, `--ring`, `--radius` in `src/index.css`). Prefer Tailwind utility classes for one-off styling; only add to `index.css` for animations/effects that need `@keyframes` or pseudo-elements.
- **No routing library** — this is a one-page site. If multi-page routing is ever introduced, evaluate `react-router-dom` rather than hand-rolling it.
- The `/api` prefix on the backend is load-bearing: frontend requests, and any future reverse-proxy rule, assume the API is namespaced under `/api` alongside the frontend build on the same origin.
