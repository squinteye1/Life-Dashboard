/**
 * Supabase data layer for Life Dashboard.
 *
 * Nothing imports this module yet. It is deliberately not wired into App.jsx
 * so the bundle is unaffected until the cutover is deliberate.
 *
 * Design notes
 * ------------
 * Reads return the *same shapes the app already uses*, so the read path in
 * App.jsx barely changes. Writes are fine-grained instead, because a
 * "save the whole year of habit data" call does not map onto a table where
 * each row is one habit on one day.
 *
 * Every write is an explicit call. There is no autosave and no debounce,
 * because every screen in the app already commits through a button or a
 * single click. See the note on `save` below for why that matters.
 */

import { createClient } from '@supabase/supabase-js';

const T = {
  habits: 'habits',
  habitLogs: 'habit_logs',
  checkIns: 'check_ins',
  weights: 'weights',
  journal: 'journal_entries',
  tasks: 'tasks',
  settings: 'settings'
};

// How far back hydrate() reads. Covers the current year plus enough history
// for the 366-day streak walk, and for last year's heatmap.
const DEFAULT_HISTORY_YEARS = 2;

// ---------------------------------------------------------------------------
// Row <-> app shape
//
// Postgres uses snake_case and ISO timestamps; the app uses camelCase and
// millisecond numbers. All of that conversion lives here and nowhere else.
// ---------------------------------------------------------------------------

const toMs = (iso) => (iso ? new Date(iso).getTime() : null);
const toIso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const toDate = (day) => day; // 'YYYY-MM-DD' already matches Postgres `date`

export function rowToTask(r) {
  return {
    id: r.id,
    areaId: r.area_id,
    title: r.title,
    description: r.description,
    status: r.status,
    createdAt: toMs(r.created_at),
    modifiedAt: toMs(r.modified_at),
    completedAt: toMs(r.completed_at),
    deadlineAt: toMs(r.deadline_at)
  };
}

export function taskToRow(t, userId) {
  return {
    user_id: userId,
    id: t.id,
    area_id: t.areaId,
    title: t.title || '',
    description: t.description || '',
    status: t.status || 'todo',
    deadline_at: toIso(t.deadlineAt),
    modified_at: toIso(t.modifiedAt ?? Date.now()),
    completed_at: toIso(t.completedAt)
  };
}

export function rowToHabit(r) {
  return { id: r.id, name: r.name, note: r.note, accent: r.accent };
}

// check_ins row -> dailyData value
export function rowToCheckIn(r) {
  return {
    vibe: r.vibe,
    stress: r.stress,
    energy: r.energy,
    savedAt: toMs(r.updated_at)
  };
}

// journal row -> journalData value. The app calls the field `text`; the
// column is `body`.
export function rowToJournal(r) {
  return {
    mood: r.mood,
    tags: r.tags || [],
    text: r.body || '',
    savedAt: toMs(r.updated_at)
  };
}

// weights row -> weightData value. `kg` comes back as a string because the
// column is `numeric`.
export function rowToWeight(r) {
  return { kg: Number(r.kg), savedAt: toMs(r.updated_at) };
}

// ---------------------------------------------------------------------------
// Result handling
//
// Nothing here throws by default. A rejected write that nobody looks at is
// how an entry disappears quietly, so every result carries `ok` and every
// failure also goes to the registered onError handler.
// ---------------------------------------------------------------------------

function ok(data) {
  return { ok: true, data, error: null };
}

function fail(error) {
  return { ok: false, data: null, error };
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

// Year bounds as Postgres `date` strings. The graphs are all year-scoped, so
// this is the workhorse: a few hundred rows per call instead of everything.
export function yearRange(year) {
  return { gte: `${year}-01-01`, lt: `${year + 1}-01-01` };
}

// groupRows(rows, keyField) -> { 'YYYY-MM-DD': value }
function groupByDay(rows, keyField, map) {
  const out = {};
  for (const r of rows) out[r[keyField]] = map(r);
  return out;
}

// habit_logs rows -> { day: { habitId: true } }
function groupHabitLogs(rows) {
  const out = {};
  for (const r of rows) {
    if (!out[r.day]) out[r.day] = {};
    out[r.day][r.habit_id] = true;
  }
  return out;
}

// task rows -> { areaId: [task] }
function groupTasks(rows) {
  const out = {};
  for (const r of rows) {
    const t = rowToTask(r);
    if (!out[t.areaId]) out[t.areaId] = [];
    out[t.areaId].push(t);
  }
  return out;
}

function yearStartMs(years) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(0);
  d.setFullYear(d.getFullYear() - years);
  return d;
}

function dayKeyOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build an api instance around a Supabase client.
 *
 * @param {object} client  a @supabase/supabase-js client (or a fake in tests)
 * @param {object} [opts]
 * @param {number} [opts.historyYears]  how far back hydrate() reads
 * @param {Function} [opts.onError]     called with every failed operation
 * @param {Function} [opts.onSessionChange] called when the session changes
 */
export function createApi(client, opts = {}) {
  const historyYears = opts.historyYears ?? DEFAULT_HISTORY_YEARS;
  const onError = opts.onError || null;
  const onSessionChange = opts.onSessionChange || null;

  if (onSessionChange && client.auth?.onAuthStateChange) {
    client.auth.onAuthStateChange((_event, session) => onSessionChange(session));
  }

  // Writes need a user id. RLS scopes every row to auth.uid() anyway, so if
  // this throws there is no signed-in session and the write was never going
  // to be permitted.
  async function requireUser() {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const userId = data?.session?.user?.id;
    if (!userId) throw new Error('Not signed in');
    return userId;
  }

  // Run a query and normalise the result. `unwrap: true` returns the rows
  // directly, which is what every read below wants.
  async function read(builder, what) {
    const { data, error } = await builder;
    if (error) {
      const res = fail(error);
      if (onError) onError(what, error);
      return res;
    }
    return ok(data || []);
  }

  // Every write goes through here, so failure handling and the updated_at
  // stamp are in exactly one place.
  async function write(promise, what) {
    const { data, error } = await promise;
    if (error) {
      const res = fail(error);
      if (onError) onError(what, error);
      return res;
    }
    return ok(data);
  }

  return {
    // ---- auth ----------------------------------------------------------

    async getSession() {
      const { data, error } = await client.auth.getSession();
      return error ? fail(error) : ok(data?.session ?? null);
    },

    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        if (onError) onError('signIn', error);
        return fail(error);
      }
      return ok(data?.user ?? null);
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) {
        if (onError) onError('signOut', error);
        return fail(error);
      }
      return ok(null);
    },

    // ---- read: one shot, for app startup -------------------------------

    /**
     * Load everything the app needs to render, in the shapes it already uses.
     * Year-bounded on the daily tables, so this stays small as history grows.
     */
    async hydrate() {
      const from = dayKeyOf(yearStartMs(historyYears));

      const habitRes = await read(
        client.from(T.habits).select('*').order('position', { ascending: true }),
        'hydrate.habits'
      );
      if (!habitRes.ok) return habitRes;

      const [logs, checkIns, weights, journal, tasks, settings] = await Promise.all([
        read(client.from(T.habitLogs).select('habit_id, day').gte('day', from), 'hydrate.habit_logs'),
        read(
          client.from(T.checkIns).select('*').gte('day', from).order('day', { ascending: true }),
          'hydrate.check_ins'
        ),
        read(
          client.from(T.weights).select('*').gte('day', from).order('day', { ascending: true }),
          'hydrate.weights'
        ),
        read(
          client.from(T.journal).select('*').gte('day', from).order('day', { ascending: true }),
          'hydrate.journal'
        ),
        read(client.from(T.tasks).select('*'), 'hydrate.tasks'),
        read(client.from(T.settings).select('*').limit(1), 'hydrate.settings')
      ]);

      const firstBad = [logs, checkIns, weights, journal, tasks, settings].find((r) => !r.ok);
      if (firstBad) return firstBad;

      const s = settings.data[0];
      return ok({
        habits: habitRes.data.map(rowToHabit),
        habitData: groupHabitLogs(logs.data),
        dailyData: groupByDay(checkIns.data, 'day', rowToCheckIn),
        weightData: groupByDay(weights.data, 'day', rowToWeight),
        journalData: groupByDay(journal.data, 'day', rowToJournal),
        taskData: groupTasks(tasks.data),
        settings: { weightUnit: s?.weight_unit === 'stlb' ? 'stlb' : 'kg' }
      });
    },

    // ---- read: one year at a time, for the graphs ----------------------

    async loadYear(year) {
      const { gte, lt } = yearRange(year);
      const [logs, checkIns, weights, journal] = await Promise.all([
        read(
          client.from(T.habitLogs).select('habit_id, day').gte('day', gte).lt('day', lt),
          'loadYear.habit_logs'
        ),
        read(client.from(T.checkIns).select('*').gte('day', gte).lt('day', lt), 'loadYear.check_ins'),
        read(client.from(T.weights).select('*').gte('day', gte).lt('day', lt), 'loadYear.weights'),
        read(client.from(T.journal).select('*').gte('day', gte).lt('day', lt), 'loadYear.journal')
      ]);
      const firstBad = [logs, checkIns, weights, journal].find((r) => !r.ok);
      if (firstBad) return firstBad;
      return ok({
        habitData: groupHabitLogs(logs.data),
        dailyData: groupByDay(checkIns.data, 'day', rowToCheckIn),
        weightData: groupByDay(weights.data, 'day', rowToWeight),
        journalData: groupByDay(journal.data, 'day', rowToJournal)
      });
    },

    /** Full-text search over journal bodies. Needs the GIN index in schema.sql. */
    async searchJournal(query) {
      const q = query.trim();
      if (!q) return ok([]);
      return read(
        client
          .from(T.journal)
          .select('*')
          .textSearch('body', q, { type: 'websearch' }),
        'searchJournal'
      );
    },

    // ---- habits --------------------------------------------------------

    /** Idempotent: safe to call on every startup to seed the defaults. */
    async saveHabits(habits) {
      try {
        const userId = await requireUser();
        if (!habits.length) return ok([]);
        const rows = habits.map((h, i) => ({
          user_id: userId,
          id: h.id,
          name: h.name,
          note: h.note || '',
          accent: h.accent ?? null,
          position: i
        }));
        return await write(
          client.from(T.habits).upsert(rows, { onConflict: 'user_id,id' }).select(),
          'saveHabits'
        );
      } catch (e) {
        if (onError) onError('saveHabits', e);
        return fail(e);
      }
    },

    /**
     * One habit, one day. Toggling off is a delete, because a habit_log row
     * means "done" — there is no state to write when it is not done.
     */
    async setHabitDone(habitId, day, done) {
      try {
        const userId = await requireUser();
        const d = toDate(day);
        if (done) {
          return await write(
            client
              .from(T.habitLogs)
              .upsert(
                { user_id: userId, habit_id: habitId, day: d },
                { onConflict: 'user_id,habit_id,day' }
              )
              .select(),
            'setHabitDone'
          );
        }
        return await write(
          client
            .from(T.habitLogs)
            .delete()
            .eq('user_id', userId)
            .eq('habit_id', habitId)
            .eq('day', d),
          'setHabitDone'
        );
      } catch (e) {
        if (onError) onError('setHabitDone', e);
        return fail(e);
      }
    },

    // ---- per-day metrics ----------------------------------------------

    async upsertCheckIn(day, patch) {
      try {
        const userId = await requireUser();
        const row = {
          user_id: userId,
          day: toDate(day),
          vibe: patch.vibe ?? null,
          stress: patch.stress ?? null,
          energy: patch.energy ?? null,
          updated_at: new Date().toISOString()
        };
        return await write(
          client
            .from(T.checkIns)
            .upsert(row, { onConflict: 'user_id,day' })
            .select(),
          'upsertCheckIn'
        );
      } catch (e) {
        if (onError) onError('upsertCheckIn', e);
        return fail(e);
      }
    },

    async clearCheckIn(day) {
      try {
        const userId = await requireUser();
        return await write(
          client.from(T.checkIns).delete().eq('user_id', userId).eq('day', toDate(day)),
          'clearCheckIn'
        );
      } catch (e) {
        if (onError) onError('clearCheckIn', e);
        return fail(e);
      }
    },

    /** Always kilograms. The display unit never reaches the database. */
    async upsertWeight(day, kg) {
      try {
        const userId = await requireUser();
        return await write(
          client
            .from(T.weights)
            .upsert(
              {
                user_id: userId,
                day: toDate(day),
                kg: String(kg),
                updated_at: new Date().toISOString()
              },
              { onConflict: 'user_id,day' }
            )
            .select(),
          'upsertWeight'
        );
      } catch (e) {
        if (onError) onError('upsertWeight', e);
        return fail(e);
      }
    },

    async clearWeight(day) {
      try {
        const userId = await requireUser();
        return await write(
          client.from(T.weights).delete().eq('user_id', userId).eq('day', toDate(day)),
          'clearWeight'
        );
      } catch (e) {
        if (onError) onError('clearWeight', e);
        return fail(e);
      }
    },

    async upsertJournalEntry(day, patch) {
      try {
        const userId = await requireUser();
        return await write(
          client
            .from(T.journal)
            .upsert(
              {
                user_id: userId,
                day: toDate(day),
                mood: patch.mood ?? null,
                tags: patch.tags || [],
                body: patch.text || '',
                updated_at: new Date().toISOString()
              },
              { onConflict: 'user_id,day' }
            )
            .select(),
          'upsertJournalEntry'
        );
      } catch (e) {
        if (onError) onError('upsertJournalEntry', e);
        return fail(e);
      }
    },

    // ---- tasks ---------------------------------------------------------

    async createTask(task) {
      try {
        const userId = await requireUser();
        const now = Date.now();
        const row = {
          ...taskToRow(task, userId),
          created_at: toIso(task.createdAt ?? now),
          modified_at: toIso(task.modifiedAt ?? now)
        };
        return await write(
          client.from(T.tasks).upsert(row, { onConflict: 'user_id,id' }).select(),
          'createTask'
        );
      } catch (e) {
        if (onError) onError('createTask', e);
        return fail(e);
      }
    },

    async updateTask(task) {
      const res = await this.createTask(task);
      if (!res.ok) return fail(res.error);
      return res;
    },

    async deleteTask(id) {
      try {
        const userId = await requireUser();
        return await write(
          client.from(T.tasks).delete().eq('user_id', userId).eq('id', id),
          'deleteTask'
        );
      } catch (e) {
        if (onError) onError('deleteTask', e);
        return fail(e);
      }
    },

    // ---- settings ------------------------------------------------------

    async saveSettings(patch) {
      try {
        const userId = await requireUser();
        return await write(
          client
            .from(T.settings)
            .upsert(
              {
                user_id: userId,
                weight_unit: patch.weightUnit === 'stlb' ? 'stlb' : 'kg',
                updated_at: new Date().toISOString()
              },
              { onConflict: 'user_id' }
            )
            .select(),
          'saveSettings'
        );
      } catch (e) {
        if (onError) onError('saveSettings', e);
        return fail(e);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Default instance
//
// VITE_-prefixed values are inlined into the client bundle at build time. The
// anon key is designed to be public and is safe to ship; the service role key
// must never appear here, and must never be given a VITE_ prefix.
// ---------------------------------------------------------------------------

const url = import.meta.env?.VITE_SUPABASE_URL;
const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

let singleton = null;

export function api(options = {}) {
  if (!singleton) {
    if (!isConfigured) {
      throw new Error(
        'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
      );
    }
    singleton = createApi(createClient(url, anonKey), options);
  }
  return singleton;
}

/** Test seam: install a client (or a fake) instead of the real one. */
export function __setApi(instance) {
  singleton = instance;
}
