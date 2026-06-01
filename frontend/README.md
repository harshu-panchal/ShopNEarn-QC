# ShopAndEarn — Web Frontend

Vite + React 19 single-page app that powers the customer, seller, delivery,
and admin experiences. The backend lives one folder up in
[`../backend`](../backend) and is **not** deployed by this Netlify site —
this folder is a pure static SPA.

---

## Local development

```bash
# Node 20.19+ or 22.12+ (Vite 7 requires it).
# An `.nvmrc` is provided, so `nvm use` picks the right version.
nvm use

# 1. Install
npm install

# 2. Configure env vars
cp .env.example .env
# edit .env and fill in your local values

# 3. Run the dev server
npm run dev      # http://localhost:5173
```

Useful scripts:

| Script               | What it does                                                |
| -------------------- | ----------------------------------------------------------- |
| `npm run dev`        | Start Vite dev server with HMR.                             |
| `npm run build`      | Production build into `dist/`.                              |
| `npm run preview`    | Locally serve the production build (smoke-test before ship).|
| `npm run lint`       | ESLint over `src/`.                                          |
| `npm test`           | Jest unit tests under `__tests__/`.                          |

---

## Deploying to Netlify

The repo ships with a ready-to-use `netlify.toml` covering build settings,
SPA routing, security headers, and asset caching. You only need to wire
up the Git connection and environment variables.

### One-time setup

1. **Create a new site** in Netlify and connect it to this Git repository.
2. When prompted for build settings:

   | Field                | Value                                            |
   | -------------------- | ------------------------------------------------ |
   | **Base directory**   | `frontend`                                       |
   | **Build command**    | _(leave blank — taken from `netlify.toml`)_      |
   | **Publish directory**| _(leave blank — taken from `netlify.toml`)_      |
   | **Branch to deploy** | `main` (or whatever your release branch is)      |

3. Under **Site settings → Environment variables**, add every key from
   [`.env.example`](./.env.example). Paste in the production values:
   - `VITE_API_URL` — your deployed backend, e.g. `https://api.example.com/api`
   - `VITE_GOOGLE_MAPS_API_KEY` — restrict it to your Netlify domain(s) first.
   - All `VITE_FIREBASE_*` values from the Firebase console.
   - `VITE_FIREBASE_VAPID_KEY` — required for web push notifications.

4. Trigger a deploy. Netlify will pick up `netlify.toml` and:
   - Run `npm ci && npm run build` inside the `frontend/` directory.
   - Publish `frontend/dist/` as the site root.
   - Apply the SPA catch-all so React Router routes work on direct hits.
   - Cache `/assets/*` for 1 year (Vite emits content-hashed filenames).
   - Always revalidate `/firebase-messaging-sw.js` so push updates ship fast.

### Branch deploys & previews

Netlify will create a deploy preview for every pull request and a
branch deploy for every push to non-production branches. Both inherit
the same `netlify.toml`, so you only need to override env vars if your
backend has a separate staging URL — use **Deploy contexts** in Netlify
to scope a different `VITE_API_URL` per branch.

### Local emulation

```bash
npm i -g netlify-cli
cd frontend
netlify dev    # Uses netlify.toml + your local .env
```

`netlify dev` replays the production redirect & header rules locally,
making it the most accurate way to catch SPA-routing or service-worker
regressions before deploying.

---

## What's already configured for you

- **SPA routing** — every non-asset path rewrites to `/index.html` (200),
  so direct hits like `https://your-site/admin/experience-studio`
  resolve correctly.
- **Service worker preserved** — `/firebase-messaging-sw.js` is routed
  before the SPA catch-all and served with `Cache-Control: no-cache`
  + `Service-Worker-Allowed: /`.
- **Security headers** — `Permissions-Policy`, `Referrer-Policy`,
  `X-Content-Type-Options`, `X-Frame-Options`.
- **Asset caching** — `/assets/*` is served `immutable, max-age=1yr`.
- **Node pinned** — `NODE_VERSION = 20` in `netlify.toml`; matching
  `.nvmrc` for local consistency.
- **Bundle splitting** — see `vite.config.js`; MUI, framer-motion,
  Firebase, and Recharts are extracted into separate vendor chunks.

---

## Tech stack quick reference

- **Build**: Vite 7
- **UI**: React 19, Tailwind 4, MUI 7, lucide-react
- **State / data**: React Router 7, Axios, Socket.IO client, Firebase 11
- **Maps**: `@react-google-maps/api`
- **Animations**: framer-motion 12, Lottie, Lenis
