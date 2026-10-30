# Life Dashboard

A single-page React + Vite personal life dashboard with a refined dark theme, backed by Supabase/Postgres with row-level security. Five top-level views:

- **Daily** — overview of the viewing date: check-in summary (vibe / stress / energy / weight), habits progress, overdue / today / tomorrow / this-week deadlines, a create-task button, today's journal preview, and the weight trend chart. Tap the check-in card to open the drawer.
- **Habits** — GitHub-style yearly heatmap, today's 10-habit list with per-habit streaks, and year stats.
- **Tasks** — per-area task **tables** across 7 life areas, with an All / Events / Tasks filter (counts shown). Each task has Title, Description, Status (To Do / In Progress / Done / Rejected), Area, Created, Modified, Completed, Deadline, and an Event flag. Click any row to open the edit drawer; deadlines turn red when overdue.
- **Journal** — date-keyed mood + tags + free text, set in a DM Serif Display textarea.
- **Analytics** — trends across habits, wellbeing and tasks over one shared period (30d / 90d / YTD / All).

## Setup

The app talks to Supabase, so it needs a project before it will run. `.env.local` is gitignored:

```bash
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

`VITE_`-prefixed values are inlined into the client bundle at build time. The anon key is designed to be public and safe to ship — **never give the service role key a `VITE_` prefix.**

Apply the schema, then any migrations in order:

```bash
supabase db push           # or: psql -f supabase/schema.sql
psql -f supabase/migrations/0001_add_task_is_event.sql
psql -f supabase/migrations/0002_fix_vibe_range.sql
```

## Run

```bash
npm install
npm run dev
```

Then open the URL Vite prints (default `http://localhost:5173`). The app opens on a sign-in screen — email and password, Supabase auth.

If `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing, `api()` throws on construction and the sign-in screen reports that the app is not configured.

## Build

```bash
npm run build
npm run preview
```

## Data model

Seven tables, each with RLS enabled and an `"own rows"` policy scoped to `auth.uid()`. Postgres uses snake_case and ISO timestamps; the app uses camelCase and millisecond numbers. All conversion lives in `src/api.js` and nowhere else.

| Table | App shape | Holds |
|---|---|---|
| `habits` | `Habit[]` | the habit list |
| `habit_logs` | `habitData` | `{ 'YYYY-MM-DD': { habitId: boolean } }` |
| `check_ins` | `dailyData` | `{ 'YYYY-MM-DD': { vibe, stress, energy } }` |
| `weights` | `weightData` | `{ 'YYYY-MM-DD': { kg, savedAt } }` |
| `journal_entries` | `journalData` | `{ 'YYYY-MM-DD': { mood, tags, text } }` |
| `tasks` | `taskData` | `{ areaId: Task[] }` |
| `settings` | `settings` | e.g. `weightUnit` |

`Task` has `id`, `title`, `description`, `status` (`todo` | `in_progress` | `done` | `rejected`), `areaId`, `isEvent`, `createdAt`, `modifiedAt`, `completedAt`, `deadlineAt`.

**Vibe** is a Map of Consciousness level — one of 17 named stages on a 20–700 scale (`HAWKINS_LEVELS` in `src/areas.js`). **Stress** and **energy** are 1–10.

Reads are the same shapes the app already used, so `hydrate()` is the single entry point and reads back two years of history. Writes are fine-grained and explicit: there is no autosave and no debounce, because a network write per state change would mean a request per keystroke in the journal textarea.

## The 10 global habits

Tracked as daily toggles and rendered in the GitHub-style heatmap. Cell intensity is the number completed out of 10, mapped to five intensity bands.

| # | Habit | Note |
|---|---|---|
| 1 | Sleep 7+ | 7+ hours of sleep |
| 2 | Regulation | Emotions in check |
| 3 | Exercise | Move the body |
| 4 | Fasting | Honour the window |
| 5 | No Alcohol | Clear and steady |
| 6 | Hydration | Water through the day |
| 7 | Learning | One thing learned |
| 8 | Meditation | Sit, even briefly |
| 9 | No Social Media | Out of the feed |
| 10 | 1 Task | One meaningful task |

Seeded on first run — the habit list is written once when the table is empty, then owned by the user.

## The 7 life areas

Health, Social, Environment, Family, Finances, Growth, Career — each with its own pastel accent colour. Areas organise the Tasks view; the same area ids are also available as journal tags.

## Weight

Stored always in kg. The display unit is a setting only, so switching between kg and st·lb never rewrites history.

- Metric shows one decimal; imperial rounds to the nearest pound.
- The chart plots in lb when imperial is selected. A stones axis would need ~0.5 st steps, far too coarse for a 1 lb weekly change, so the axis uses the smaller natural unit and the st·lb compound appears in the readout, tooltip and input instead.
- The 7-day mean is a **trailing calendar** window, not the last 7 readings — skipping a fortnight must not leave the mean tracking a three-month-old number. It averages only the readings actually present in the window, and needs **3+ readings** before it emits anything, so a single early reading never looks like a trend. The card says so when it is still waiting.

## Analytics

One period selector drives every panel, so they cannot disagree with each other.

- **Zone streaks** — runs at or above Hawkins' own dividing lines, Neutrality (250) and Acceptance (350). A day with no check-in breaks neither count.
- **Level heatmap** — one cell per day, coloured by the exact level logged. Levels are equally spaced rather than plotted on the raw 20–700 score, because that score grows ~1.24× per level and a linear axis would flatten everything between Fear and Reason into one band.
- **Dose-response** — buckets every day by how many habits were kept, then takes the median level in each bucket. The gradient is only claimed when the buckets actually climb.
- **Habit vs vibe** — median *rank* of vibe on days a habit was kept against days it was not. Median of ranks is valid on an ordinal scale; a mean of the raw 20–700 values would not be. Needs 5+ paired days in each group before it shows a comparison.

Everything is computed from state already in memory, so there is no query and no schema change — which also means the page can only see as far back as the loaded data does, and the panels say so when the window is thin.

## Design

- **`#080808`** near-black background with a subtle radial wash behind the brand area.
- **Dark surfaces** `#0d0d0d` / `#121212` / `#161616`, hairline borders `#2c2c2c`, no shadows.
- **DM Sans** for body, **DM Mono** for numbers and metadata, **DM Serif Display** for the journal textarea.
- **Per-view accent** — each view container redefines `--accent`, so the many `var(--accent)` rules inside it retheme with no extra selectors. Habits jade, Daily blue, Tasks amber, Journal rose, Analytics violet.
- **Heatmap** — 53 weeks × 7 days, 5-level intensity scale, hover tooltip with date and `X/10 completed`. Year navigation with prev/next and a Today button.
- **Journal** — date picker capped at today, 5-level mood selector, area tags that colour up when active, side drawer of past entries.

## Responsive

Breakpoints at 900 / 820 / 760 / 640 / 540 / 420 px. On small screens the header pills are replaced by a persistent bottom bar (always visible rather than behind a hamburger, so switching views is one tap and always in the same place), heatmap cells shrink to 9 px, and type tokens step up for reading at arm's length. The page works down to ~360 px.

## Project layout

```
src/
  App.jsx      all five views, drawers, and the app shell
  api.js       Supabase data layer — the only module that talks to the network
  areas.js     domain data: areas, habits, Hawkins levels, moods
  weight.js    unit conversion and series maths
  storage.js   date and id helpers only (no storage, no network)
  styles.css   one stylesheet, tokenised
public/
  manifest.webmanifest   PWA manifest — name, standalone display, theme colours
  icon-*.png             app icons, generated by make-icons.mjs
supabase/
  schema.sql + migrations/
```

The verification scripts (`test-*.mjs`, `verify-*.mjs`, `check-*.mjs`) live loose at the repo root and are run directly with `node`, not via npm scripts. `fake-supabase.mjs` backs the ones that need a data layer.

## Installable (PWA)

The app installs on Android from the Chrome menu as **Install app** — a standalone
home-screen icon with no browser chrome — rather than a plain shortcut. That
needs a web app manifest, so `public/manifest.webmanifest` is linked from
`index.html` and Vite copies `public/` to the root of `dist/`.

The manifest declares `display: standalone`, `start_url: "/"`, the `#080808`
theme colour, and four icons: 192 and 512 px in both `any` and `maskable`
purposes. The maskable variants keep the artwork inside the 40% safe zone so no
launcher mask can clip it.

There is no image tooling in the project, so the icons are rasterised by
`make-icons.mjs` — signed-distance fields for the rounded plate and the
heatmap cells, and a small PNG encoder over `node:zlib`. It is deterministic,
and the mark is the jade habit heatmap on the app's near-black background.

```bash
node make-icons.mjs   # rewrites public/icon-*.png
```

**Chrome only offers the install prompt over HTTPS** (localhost counts). Served
over plain HTTP on a LAN address the site is not a secure context and the
prompt never appears — put the built `dist/` behind a real HTTPS host, or use a
tunnel such as `npx cloudflared tunnel --url http://localhost:5173` while
developing.

There is deliberately **no service worker**. It is not required for the install
prompt, and one that cached broadly would risk serving stale rows or
intercepting a write on the way to Supabase — the data layer expects one
action to be exactly one request.
