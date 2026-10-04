-- ============================================================================
-- Life Dashboard — database schema
--
-- Creates EMPTY tables. It does NOT read, move or import any existing data.
-- Any records you already hold in localStorage stay where they are; deleting
-- them from the browser afterwards is a separate, optional step.
--
-- Run this once in the Supabase SQL editor (Dashboard > SQL Editor > New query).
-- Every statement is idempotent, so re-running it is safe.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- habits
--
-- `id` is text and client-supplied (GLOBAL_HABITS ships readable ids like
-- 'h_sleep'), so seeding is a plain idempotent upsert and no insert needs a
-- round-trip just to learn the new id.
--
-- The primary key is (user_id, id) rather than id alone: two people could
-- both have a habit called 'h_sleep', and a bare PK would collide.
--
-- `position` exists because rows come back in arbitrary order without it, and
-- the app renders habits in a deliberate order. Without this column the habit
-- list would reshuffle between loads.
-- ---------------------------------------------------------------------------
create table if not exists public.habits (
  user_id    uuid not null references auth.users(id) on delete cascade,
  id         text not null,
  name       text not null,
  note       text not null default '',
  accent     text,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists habits_user_position_idx
  on public.habits (user_id, position);


-- ---------------------------------------------------------------------------
-- habit_logs
--
-- One row per (habit, day) rather than a per-day document. Toggling one habit
-- would otherwise have to rewrite every habit for that day. Presence means
-- done, so there is no `done` boolean that could disagree with reality.
--
-- The composite foreign key is scoped to the same user, so one person's
-- habit_logs can never point at another person's habit.
-- ---------------------------------------------------------------------------
create table if not exists public.habit_logs (
  user_id  uuid not null references auth.users(id) on delete cascade,
  habit_id text not null,
  day      date not null,
  primary key (user_id, habit_id, day),
  foreign key (user_id, habit_id)
    references public.habits (user_id, id) on delete cascade
);

-- The heatmap reads by day range, which the primary key cannot serve.
create index if not exists habit_logs_user_day_idx
  on public.habit_logs (user_id, day);


-- ---------------------------------------------------------------------------
-- check_ins — vibe / stress / energy
--
-- Every metric is nullable because the app allows saving a partial check-in
-- (stress only, energy only, and so on).
-- ---------------------------------------------------------------------------
create table if not exists public.check_ins (
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  vibe       integer check (vibe between 0 and 100),
  stress     integer check (stress between 1 and 10),
  energy     integer check (energy between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);


-- ---------------------------------------------------------------------------
-- weights
--
-- Always kilograms, never pounds or stones. The display unit is a setting, so
-- storing the canonical value is what makes switching units a read-time-only
-- change with no data migration.
--
-- `numeric` rather than float: unit conversion is exactly where floating
-- point drift shows up. Note that PostgREST returns numeric as a *string*.
-- ---------------------------------------------------------------------------
create table if not exists public.weights (
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  kg         numeric(6,2) not null check (kg between 20 and 400),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create index if not exists weights_user_day_idx on public.weights (user_id, day);


-- ---------------------------------------------------------------------------
-- journal_entries
--
-- `tags` holds area ids. Areas are static config in areas.js, not a table, so
-- a text array is right here. If areas ever become user-editable this becomes
-- a join table.
--
-- `body`, not `text`: `text` is the Postgres type name and reads badly in a
-- column called text.
-- ---------------------------------------------------------------------------
create table if not exists public.journal_entries (
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  mood       text,
  tags       text[] not null default '{}',
  body       text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- Full-text search over the body. This is the one capability the presence
-- grid cannot provide: "find the entry where I wrote about X".
create index if not exists journal_entries_body_fts_idx
  on public.journal_entries
  using gin (to_tsvector('english', coalesce(body, '')));


-- ---------------------------------------------------------------------------
-- tasks
--
-- The status CHECK must list exactly the ids in TASK_STATUS, otherwise rows
-- can exist that the UI has no way to render.
--
-- `id` is text and client-supplied, for the same reason as habits.id.
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  user_id      uuid not null references auth.users(id) on delete cascade,
  id           text not null,
  area_id      text not null,
  title        text not null default '',
  description  text not null default '',
  status       text not null default 'todo'
                 check (status in ('todo', 'in_progress', 'done', 'rejected')),
  deadline_at  timestamptz,
  created_at   timestamptz not null default now(),
  modified_at  timestamptz not null default now(),
  completed_at timestamptz,
  -- A finished task must have a completion time, or the Completed column
  -- in the task table renders empty forever.
  constraint tasks_done_has_completed_at
    check (status <> 'done' or completed_at is not null),
  primary key (user_id, id)
);

create index if not exists tasks_user_status_idx on public.tasks (user_id, status);

-- Partial index: the daily view only ever asks for tasks that have a
-- deadline, so indexing the nullable ones is a waste.
create index if not exists tasks_user_deadline_idx
  on public.tasks (user_id, deadline_at)
  where deadline_at is not null;


-- ---------------------------------------------------------------------------
-- settings — one row per user
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  weight_unit text not null default 'kg' check (weight_unit in ('kg', 'stlb')),
  updated_at  timestamptz not null default now()
);


-- ============================================================================
-- Row Level Security
--
-- RLS — not the sign-in screen — is what protects this data. The anon key is
-- designed to be public and shipped in a client app, so any table left with
-- RLS disabled is world-readable and world-writable through it. RLS is OFF by
-- default on new tables, which is the single most common way Supabase data
-- leaks.
--
-- `using`      -> filters what you can SELECT / UPDATE / DELETE
-- `with check` -> validates what you are trying to INSERT or UPDATE
--
-- Both clauses are required. With only `using`, reads are filtered but you can
-- still insert a row stamped with somebody else's user_id.
--
-- `to authenticated` additionally blocks anonymous requests outright.
-- ============================================================================

alter table public.habits           enable row level security;
alter table public.habit_logs       enable row level security;
alter table public.check_ins        enable row level security;
alter table public.weights          enable row level security;
alter table public.journal_entries  enable row level security;
alter table public.tasks            enable row level security;
alter table public.settings         enable row level security;

create policy "own rows" on public.habits
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own rows" on public.habit_logs
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own rows" on public.check_ins
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own rows" on public.weights
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own rows" on public.journal_entries
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own rows" on public.tasks
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own rows" on public.settings
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ============================================================================
-- Verify the lockdown before writing any application code
--
-- Run these checks yourself, in a private/incognito window with no session:
--
--   curl "<VITE_SUPABASE_URL>/rest/v1/weights?select=*" \
--        -H "apikey: <VITE_SUPABASE_ANON_KEY>"
--
-- Expected: an empty array. Not a permission error, and certainly not rows.
-- If you see rows, RLS is not doing its job and you should stop here.
--
-- Optional: the Supabase dashboard has an "auth.email.autoconfirm" setting.
-- Leave signups open if you like — RLS is the actual gate, and anybody who
-- signs up gets a different user_id and therefore sees nothing. Disabling
-- public signups is belt-and-braces on top of that.
-- ============================================================================
