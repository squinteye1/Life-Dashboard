-- 0002_fix_vibe_range.sql
--
-- Fixes a 400 (Bad Request) when saving any vibe above 100.
--
-- check_ins.vibe was declared as `check (vibe between 0 and 100)`, but the
-- app stores Hawkins "Map of Consciousness" values, which run 20 to 700
-- (Peace 600, Enlightenment 700). Only the five lowest levels ever fitted
-- the constraint; everything from Desire (125) upward failed the check and
-- was silently rejected by the database.
--
-- Hawkins is conventionally a 1-1000 scale, so the constraint is widened to
-- that rather than removed: it still rejects nonsense while accepting the
-- real data.
--
-- Applying this to an existing database:
--   Supabase dashboard > SQL Editor > paste > Run
--
-- Idempotent: safe to run more than once.

-- Drop whichever check constraint currently covers vibe, whatever it is
-- named. Guessing the name would leave the old constraint in place if
-- Postgres auto-named it differently, and the bug would persist.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.check_ins'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%vibe%'
  loop
    execute format('alter table public.check_ins drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.check_ins
  add constraint check_ins_vibe_range check (vibe between 0 and 1000);

comment on column public.check_ins.vibe is
  'Hawkins Map of Consciousness value, 20-700 in this app (scale is 1-1000).';