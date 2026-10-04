# Life Dashboard

A single-page React + Vite personal life dashboard with a refined dark theme. Four top-level views:

- **Habits** — GitHub-style yearly heatmap + today's 10-habit list with streaks.
- **Areas** — per-area task **tables** across 7 life areas. Each task has Title, Description, Status (To Do / In Progress / Done / Rejected), Area, Created, Modified, Completed, and a Deadline. Click any row to open the edit drawer; deadlines turn red when overdue.
- **Journal** — date-keyed mood + tags + free text with a serif textarea.
- **Daily** — overview of the viewing date: today's check-in summary, habits progress, overdue / today / tomorrow / this-week deadlines, and today's journal preview. Tap the check-in card to open the vibe / stress / energy drawer.

## Run

```bash
npm install
npm run dev
```

Then open the URL Vite prints (default `http://localhost:5173`).

## Build

```bash
npm run build
npm run preview
```

## The 10 global habits

These are tracked as daily toggles and rendered in the GitHub-style heatmap. The cell intensity for each day is the number completed out of 10, mapped to five intensity bands.

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

## The 7 life areas

Health, Social, Environment, Family, Finances, Growth, Career — each with its own pastel accent colour. Areas organise the Task panel; the same area ids are also available as journal tags.

## Design

- **`#080808`** near-black background with a very subtle radial wash behind the brand area.
- **Dark surfaces** `#0d0d0d` / `#121212` / `#161616`, hairline borders, no shadows.
- **DM Sans** for body, **DM Mono** for numbers and metadata, **DM Serif Display** for the journal textarea.
- **Area-coloured gradient** on the top edge of the active panel and on the active area pill card.
- **Heatmap** — 53 weeks × 7 days, 5-level intensity scale (jade), hover tooltip with date and `X/10 completed`. Year navigation with prev/next and a Today button.
- **Year stats** — completions, days tracked, perfect days, best streak, and year-to-date % in a single row.
- **Today's habits** — list of 10 with checkbox toggles and live streak counts per habit.
- **Journal** — date picker (capped at today), 5-level mood selector, area tags that colour up when active, save with auto-fading confirmation, side drawer of past entries.

## Responsive

- Desktop ≥ 900 px: full layout.
- Tablet 640–900 px: stats collapse to 3 columns, journal becomes single-column.
- Phone < 640 px: heatmap cells shrink to 9 px, brand hides, nav pills get tighter, priority controls stack vertically. The page works at any width down to ~360 px.

## State & persistence

All state is persisted to `localStorage`. Keys:

- `habits` — `Habit[]` (flat list of 10 global habits)
- `habitData` — `{ 'YYYY-MM-DD': { habitId: boolean } }` (per-day log)
- `taskData` — `{ areaId: Task[] }` (per-area). Each Task has `id`, `title`, `description`, `status` (`todo` | `in_progress` | `done` | `rejected`), `areaId`, `createdAt`, `modifiedAt`, `completedAt`, `deadlineAt`.
- `journalData` — `{ 'YYYY-MM-DD': { mood, tags, text, savedAt } }`
- `dailyData` — `{ 'YYYY-MM-DD': { vibe, stress, energy, savedAt } }`. `vibe` is a Map of Consciousness level (20–700); `stress` and `energy` are 1–10.

The v1 storage (`kpis`, `kpiData`, per-area-shaped `habits` / `habitData`) is automatically migrated and cleared on first load. To swap to Supabase later, replace the single read/write helpers in `src/storage.js`.
