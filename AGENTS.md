# AGENTS.md

Life Dashboard — React 18 + Vite SPA, Supabase/Postgres with RLS. `README.md` is
authoritative for product, design and data-model detail; this file is what you
cannot infer from reading the code.

## Commands

```bash
npm install
npm run dev          # vite, port 5173 (open: false)
npm run build        # vite build -> dist/
npm run preview
```

There is **no lint, typecheck, test script, CI workflow, eslint/prettier config,
or tsconfig**. `npm test` does not exist. Verification is a set of loose scripts
at the repo root, run directly:

```bash
node test-api.mjs            # data layer vs simulated RLS backend
node test-cutover.mjs        # auth gate, hydrate, one-action-one-write, error surfacing
node verify-constraints.mjs  # every SQL CHECK accepts every value the app can produce
node checkrefs.mjs           # unresolved-call heuristic over src/
node make-icons.mjs          # regenerate public/icon-*.png (PWA icons)
```

**Run them from the repo root.** They read relative paths (`src/App.jsx`,
`src/styles.css`, `.env.local`, `supabase/schema.sql`) and some write temp files
into `src/`.

`check-supabase.mjs` is the only script that touches the network — it calls the
real Supabase project with the anon key from `.env.local` and asserts schema +
RLS. Everything else is offline.

## jsdom is an undeclared dependency

`test-auth`, `test-cutover`, `test-closed-counts`, `test-events-ui`,
`test-habits-nav`, `test-imperial`, `test-menu`, `test-no-column` import `jsdom`.
It is installed but **extraneous** — absent from `package.json` *and* from
`package-lock.json` (`npm ls jsdom` reports `extraneous`). A clean `npm ci`
removes it and all eight scripts die with a module-not-found error. Fix with
`npm i -D jsdom`.

## Test harness coupling (easy to break silently)

- Each jsdom script copies `src/App.jsx` to `src/__app.jsx` by string-replacing
  `"from './api.js'"` with the shim path. **Keep that exact import specifier in
  `src/App.jsx`** — change it to `./api` or add `.jsx` and the copy keeps the
  real client, `api()` throws "Supabase is not configured", and the tests fail
  with an unhelpful blank render.
- The scripts write `src/__app.jsx` and `src/__api-shim.js` into `src/` and
  `unlink` them on clean exit. **They are not gitignored.** If a script crashes
  or is interrupted, delete both by hand — a stale `__app.jsx` sits in the
  source tree.
- The shim deliberately exports `(options) => createApi(client, options)`
  instead of a pre-built instance. Reason: `api()` in `src/api.js` memoises a
  singleton on first call, so options passed on any later call are ignored, and
  `onError` would never be registered.
- jsdom has no layout engine and does not apply media queries. That is why
  `test-menu` / `verify-responsive` assert against the stylesheet *text*, and why
  responsive work must be checked in a real browser.

## Pre-existing failures — not your regression

Run the full set before you start so you know the baseline:

- `test-menu.mjs` — asserts the old hamburger/slide-in menu. The app now ships a
  persistent `.bottom-nav` (`BottomNav`, ~`App.jsx:515`; `display:none` above the
  small-screen breakpoint, `display:flex` inside it). Fails on the missing
  `.menu-toggle`, then crashes on a null element.
- `verify-responsive.mjs` — 6 failures, all hamburger-menu assertions.
- `verify-accent.mjs` — 1 failure on the "10px is confined to width-constrained
  selectors" rule, also left over from the hamburger icon.
- `checkrefs.mjs` — reports 17 "unresolved" calls in `api.js`. All false
  positives: it is a regex heuristic that cannot see object-literal method
  shorthand in `createApi`'s return object.

The other twelve scripts pass. Fix or delete the stale ones only if asked.

## Architecture notes

- `src/` is 7 files. **There is no components directory.** `App.jsx` (~4.4k
  lines) holds every view as a top-level function — `DailyView`, `HabitsView`,
  `TasksView`, `JournalView`, `AnalyticsView`, plus `Header`, `BottomNav`, and
  the drawers — and `styles.css` (~4.3k lines) is a single tokenised stylesheet.
  Add views in `App.jsx`; add styling in `styles.css` using the existing tokens.
- `api.js` is the only module that touches the network. **All** snake_case↔
  camelCase and ISO↔millisecond conversion lives there and nowhere else.
- `storage.js` is misnamed: it is pure date and id helpers with no storage and no
  network (Supabase owns persistence).
- Charts are Recharts. Fonts (DM Sans / Mono / Serif Display) are loaded from
  Google Fonts in `index.html`, not bundled.
- `public/` holds the PWA assets: `manifest.webmanifest` plus four `icon-*.png`.
  Vite copies `public/` to the root of `dist/`, so the manifest's absolute
  paths (`/manifest.webmanifest`, `/icon-192.png`) resolve in the build.
  **There is deliberately no service worker.** It is not needed for Chrome's
  install prompt, and one that cached broadly could serve stale rows or
  intercept a write heading for Supabase — see "Explicit writes only" above.
  If you ever add one, scope it to the app shell only and let every
  cross-origin request and every non-GET pass straight through.
- Icons are generated, not hand-drawn: `make-icons.mjs` rasterises the jade
  habit heatmap with signed-distance fields and encodes PNG over `node:zlib`.
  There is no image dependency in `package.json` and there should not be one —
  regenerate with `node make-icons.mjs` rather than adding a toolchain.

## Data-layer invariants the tests actually enforce

- **Explicit writes only.** One user action = exactly one network write. Typing
  in the journal textarea must write nothing. No autosave, no debounce.
- **`api` never throws on a failed operation.** Every method returns
  `{ ok, data, error }` and also calls the registered `onError`; the app renders
  `.save-error-banner` / `.save-error-dismiss`. Swallow an error and an entry
  vanishes silently.
- `habit_logs` has no "not done" state: toggling off is a `DELETE`, toggling on
  is an `upsert`.
- Weight is **always stored in kg** as a string (numeric column). The display
  unit is a setting only — never rewrite history on a unit change. The default
  unit is `stlb` (`DEFAULT_WEIGHT_UNIT` in `weight.js`), not kg; tests switch to
  kg explicitly rather than assuming the drawer's form.
- `vibe` is a Hawkins Map of Consciousness value, 20–700 in the app; the SQL CHECK
  is 0–1000 (migration `0002` fixed the original 0–100 bug that rejected every
  level above Fear).
- The journal column is `body`; the app field is `text`.
- `createApi` is the factory; `api()` is the memoised real-client singleton and
  throws on construction when the env vars are missing. `__setApi` is the test
  seam.

## Schema changes

- `supabase/schema.sql` is the base; `supabase/migrations/0001_*`,
  `0002_*` apply on top, in numeric order, and must stay idempotent. No runner is
  wired into `package.json` — apply with `supabase db reset` or paste into the
  dashboard SQL editor.
- Adding a column means three things: update `schema.sql`, add the next numbered
  migration, and default the value in `api.js` (`rowToTask` defaults a missing
  `is_event` to `false` for rows written before the migration). `test-no-column.mjs`
  proves the app still works against a database that has *not* had the migration
  applied — keep it passing.
- Changing a domain in `areas.js` (vibe levels, moods, `TASK_STATUS`) usually
  breaks a SQL CHECK. `verify-constraints.mjs` exists precisely because that
  bug class is invisible until a user hits it in the UI.

## Fake backend

`fake-supabase.mjs` is a minimal in-memory supabase-js stand-in that *simulates
RLS*: reads and deletes only see the signed-in user's rows, and a write carrying
a foreign `user_id` is rejected. An unscoped query in `api.js` therefore fails a
test instead of quietly leaking rows. `__state.failTable = '<table>'` forces
writes to fail, which is how the error-surfacing path is tested.

## Environment

- `.env.local` is gitignored and must exist with `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY`, or the sign-in screen reports the app is not
  configured.
- `VITE_`-prefixed values are inlined into the client bundle at build time. The
  anon key is designed to be public. **Never give the service role key a `VITE_`
  prefix.**