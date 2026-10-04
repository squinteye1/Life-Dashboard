-- 0001_add_task_is_event.sql
--
-- Marks a task as a fixed, time-boxed event (appointment, flight, dentist)
-- rather than open-ended work. It is a visual marker only: events share the
-- existing status set, so no CHECK constraint change is needed and existing
-- rows are untouched.
--
-- Applying this to an existing database:
--   Supabase dashboard > SQL Editor > paste > Run
-- Applying it to a fresh database:
--   supabase db reset   (runs every file in supabase/migrations in order)
--
-- Idempotent: safe to run more than once.

alter table public.tasks
  add column if not exists is_event boolean not null default false;

comment on column public.tasks.is_event is
  'Visual marker for a fixed, time-boxed event. No separate status set.';
