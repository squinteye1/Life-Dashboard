// Temporary: exercise src/api.js against the fake client, with RLS simulated.
// Focus is the row <-> app-shape mapping, upsert/delete semantics, year
// scoping, and that nothing ever reads or writes another user's rows.
import { makeFakeClient } from './fake-supabase.mjs';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {},
  clear: () => {}, key: () => null, length: 0 };
globalThis.window = globalThis;
globalThis.document = { getElementById: () => null, createElement: () => ({ style: {} }) };

const { createApi } = await import('./src/api.js');

let bad = 0;
const eq = (got, want, label) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.log(`  FAIL ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
    bad++;
  }
};
const ok = (c, label) => { if (!c) { console.log(`  FAIL ${label}`); bad++; } };

const day = (s) => `2026-09-${String(s).padStart(2, '0')}`;

console.log('row -> app shape mapping:');
{
  const eq1 = await import('./src/api.js');
  const t = eq1.rowToTask({
    id: 't_1', area_id: 'work', title: 'T', description: 'D', status: 'done',
    created_at: '2026-09-01T10:00:00.000Z', modified_at: '2026-09-02T11:00:00.000Z',
    completed_at: '2026-09-02T11:00:00.000Z', deadline_at: null
  });
  eq(t.areaId, 'work', 'area_id -> areaId');
  eq(t.deadlineAt, null, 'null deadline -> null');
  eq(t.completedAt, new Date('2026-09-02T11:00:00.000Z').getTime(), 'completedAt is ms');
  const t2 = eq1.rowToTask({ id: 'x', area_id: 'a', title: '', description: '', status: 'todo',
    created_at: '2026-09-01T10:00:00.000Z', modified_at: '2026-09-01T10:00:00.000Z',
    completed_at: null, deadline_at: '2026-09-05T09:30:00.000Z' });
  eq(t2.deadlineAt, new Date('2026-09-05T09:30:00.000Z').getTime(), 'deadlineAt ISO -> ms');
  // numeric arrives as a string from PostgREST
  eq(eq1.rowToWeight({ kg: '82.40', updated_at: '2026-09-01T10:00:00.000Z' }).kg, 82.4, 'numeric string -> Number');
  const j = eq1.rowToJournal({ mood: 4, tags: ['work'], body: 'hi', updated_at: '2026-09-01T10:00:00.000Z' });
  eq(j.text, 'hi', 'body -> text');
  eq(j.tags, ['work'], 'tags array');
  const c = eq1.rowToCheckIn({ vibe: 45, stress: 3, energy: 7, updated_at: '2026-09-01T10:00:00.000Z' });
  eq(c.vibe, 45, 'vibe passthrough');
  eq(c.savedAt, new Date('2026-09-01T10:00:00.000Z').getTime(), 'savedAt is ms');
  eq(eq1.rowToCheckIn({ vibe: null, stress: null, energy: null, updated_at: '2026-09-01T10:00:00.000Z' }).vibe, null, 'null vibe');
}

console.log('task round-trip:');
{
  const api = createApi(makeFakeClient());
  const created = { id: 't_9', areaId: 'work', title: 'Write', description: 'd',
    status: 'done', createdAt: 1000, modifiedAt: 2000, completedAt: 2000, deadlineAt: 3000 };
  const res = await api.createTask(created);
  ok(res.ok, 'createTask ok');
  const h = await api.hydrate();
  ok(h.ok, 'hydrate ok');
  const back = h.data.taskData.work[0];
  eq(back.id, 't_9', 'id round-trips');
  eq(back.areaId, 'work', 'areaId round-trips');
  eq(back.deadlineAt, 3000, 'deadlineAt ms round-trips');
  eq(back.completedAt, 2000, 'completedAt ms round-trips');
  eq(back.title, 'Write', 'title round-trips');
  const del = await api.deleteTask('t_9');
  ok(del.ok, 'deleteTask ok');
  const h2 = await api.hydrate();
  eq(h2.data.taskData, {}, 'task removed');
}

console.log('habit toggling is insert-on / delete-off:');
{
  const client = makeFakeClient();
  const api = createApi(client);
  await api.saveHabits([{ id: 'h_sleep', name: 'Sleep 7+', note: 'n', accent: '#fff' }]);
  await api.setHabitDone('h_sleep', day(1), true);
  eq(client.__tables.habit_logs.length, 1, 'one log row created');
  await api.setHabitDone('h_sleep', day(1), true);
  eq(client.__tables.habit_logs.length, 1, 're-toggling on does not duplicate');
  const h = await api.hydrate();
  eq(h.data.habitData[day(1)], { h_sleep: true }, 'habitData shape');
  await api.setHabitDone('h_sleep', day(1), false);
  eq(client.__tables.habit_logs.length, 0, 'toggling off deletes the row');
  eq((await api.hydrate()).data.habitData[day(1)], undefined, 'habitData entry gone');
}

console.log('habit order survives:');
{
  const api = createApi(makeFakeClient());
  await api.saveHabits([{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }]);
  const h = await api.hydrate();
  eq(h.data.habits.map((x) => x.id), ['b', 'a'], 'saved order preserved, not sorted by id');
  eq(h.data.habits[0].name, 'B', 'names line up with order');
}

console.log('per-day records upsert rather than duplicate:');
{
  const client = makeFakeClient();
  const api = createApi(client);
  await api.upsertWeight(day(2), 82.4);
  await api.upsertWeight(day(2), 82.0);
  eq(client.__tables.weights.length, 1, 'one row per day after two saves');
  eq(Number(client.__tables.weights[0].kg), 82, 'latest value wins');
  await api.upsertCheckIn(day(2), { vibe: 45, stress: 3, energy: 7 });
  await api.upsertCheckIn(day(2), { vibe: 45, stress: 4, energy: 7 });
  eq(client.__tables.check_ins.length, 1, 'one check_in row per day');
  eq(client.__tables.check_ins[0].stress, 4, 'patched field updated');
  const h = await api.hydrate();
  eq(h.data.dailyData[day(2)], { vibe: 45, stress: 4, energy: 7, savedAt: h.data.dailyData[day(2)].savedAt }, 'dailyData shape');
  await api.clearWeight(day(2));
  eq(client.__tables.weights.length, 0, 'clearWeight deletes');
  await api.clearCheckIn(day(2));
  eq(client.__tables.check_ins.length, 0, 'clearCheckIn deletes');
}

console.log('weights are stored in kg only, never in display units:');
{
  const client = makeFakeClient();
  const api = createApi(client);
  await api.upsertWeight(day(3), 82.4);
  eq(client.__tables.weights[0].kg, '82.4', 'kg column holds the kg value');
  ok(!('lb' in client.__tables.weights[0]) && !('stones' in client.__tables.weights[0]),
    'no unit-specific columns');
  await api.saveSettings({ weightUnit: 'stlb' });
  eq(client.__tables.settings[0].weight_unit, 'stlb', 'unit is a setting');
  const h = await api.hydrate();
  eq(h.data.settings, { weightUnit: 'stlb' }, 'settings round-trip');
  eq(h.data.weightData[day(3)].kg, 82.4, 'stored kg unchanged by unit setting');
}

console.log('RLS: another user\'s rows are invisible and unwritable:');
{
  const client = makeFakeClient({
    userId: 'user-1',
    seed: {
      check_ins: [
        { user_id: 'user-1', day: day(1), vibe: 50, stress: 2, energy: 5, updated_at: '2026-09-01T00:00:00.000Z' },
        { user_id: 'user-2', day: day(2), vibe: 10, stress: 9, energy: 1, updated_at: '2026-09-02T00:00:00.000Z' }
      ],
      weights: [
        { user_id: 'user-2', day: day(2), kg: '200.00', updated_at: '2026-09-02T00:00:00.000Z' }
      ]
    }
  });
  const api = createApi(client);
  const h = await api.hydrate();
  eq(Object.keys(h.data.dailyData), [day(1)], 'only own check_ins visible');
  eq(h.data.dailyData[day(2)], undefined, "other user's day hidden");
  eq(h.data.weightData, {}, "other user's weights hidden");
  // A write claiming someone else's id must be refused by `with check`.
  const bad = await client.from('check_ins')
    .upsert({ user_id: 'user-2', day: day(4), vibe: 1 }, { onConflict: 'user_id,day' });
  ok(bad.error != null, 'RLS with check rejects a foreign user_id');
}

console.log('year scoping:');
{
  const client = makeFakeClient();
  const api = createApi(client, { historyYears: 1 });
  await api.upsertWeight('2024-05-05', 90);
  await api.upsertWeight('2025-05-05', 88);
  await api.upsertWeight(day(6), 82);
  const y = await api.loadYear(2025);
  ok(y.ok, 'loadYear ok');
  eq(Object.keys(y.data.weightData), ['2025-05-05'], 'loadYear returns only that year');
  const h = await api.hydrate();
  ok(!h.data.weightData['2024-05-05'], 'hydrate honours historyYears');
  ok(h.data.weightData['2025-05-05'], 'recent year still included');
  const calls = client.__state.calls.filter((c) => c.table === 'weights' && c.op === 'select');
  ok(calls.length >= 2, 'both reads happened');
  const yRange = calls.find((c) => c.filters.some((f) => f[1] === 'day' && f[2] === '2025-01-01'));
  ok(!!yRange, 'loadYear used an explicit day range');
  ok(yRange.filters.some((f) => f[0] === 'lt' && f[2] === '2026-01-01'), 'range is half-open');
}

console.log('journal search:');
{
  const api = createApi(makeFakeClient());
  await api.upsertJournalEntry(day(7), { mood: 5, tags: ['work'], text: 'the auth refactor clicked' });
  await api.upsertJournalEntry(day(8), { mood: 2, tags: [], text: 'rain all day' });
  const h = await api.hydrate();
  eq(h.data.journalData[day(7)].text, 'the auth refactor clicked', 'body stored and read back');
  eq(h.data.journalData[day(7)].tags, ['work'], 'tags stored');
  const found = await api.searchJournal('auth');
  ok(found.ok, 'search ok');
  eq(found.data.length, 1, 'search found one entry');
  eq(found.data[0].day, day(7), 'search hit the right day');
  eq((await api.searchJournal('   ')).data, [], 'blank query returns nothing');
}

console.log('failures are loud, never silent:');
{
  const errors = [];
  const api = createApi(makeFakeClient(), { onError: (what, e) => errors.push([what, e?.message ?? e?.toString()]) });
  const res = await api.upsertWeight(day(9), 82);
  ok(res.ok, 'successful write is ok');
  eq(res.error, null, 'no error on success');
  ok(errors.length === 0, 'no error callback on success');
  // Signed out: writes must fail rather than quietly no-op.
  const out = createApi(makeFakeClient({ signedIn: false }), { onError: (w, e) => errors.push([w, e?.message]) });
  const r2 = await out.upsertWeight(day(9), 82);
  ok(!r2.ok, 'write while signed out fails');
  ok(/Not signed in/.test(r2.error?.message || ''), 'failure explains why');
  ok(errors.length > 0, 'onError was called');
  // A read that fails should not be mistaken for empty data.
  const failing = () => Promise.resolve({ data: null, error: { message: 'boom' } });
  const chain = () => {
    const b = {};
    for (const m of ['select', 'order', 'limit', 'eq', 'gte', 'lt', 'textSearch', 'upsert', 'insert', 'delete']) {
      b[m] = () => b;
    }
    b.then = (onOk, onErr) => failing().then(onOk, onErr);
    return b;
  };
  const broken = createApi({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u' } } }, error: null }) },
    from: () => chain()
  });
  const r3 = await broken.hydrate();
  ok(!r3.ok, 'hydrate reports failure instead of returning empty shapes');
}

console.log('auth:');
{
  const client = makeFakeClient({ signedIn: false });
  let sawChange = null;
  const api = createApi(client, { onSessionChange: (s) => { sawChange = s; } });
  eq((await api.getSession()).data, null, 'no session initially');
  const signed = await api.signIn('me@example.com', 'pw');
  ok(signed.ok, 'signIn ok');
  eq(signed.data.email, 'me@example.com', 'signIn returns the user');
  ok((await api.getSession()).data != null, 'session present after sign in');
  ok((await api.signOut()).ok, 'signOut ok');
  eq((await api.getSession()).data, null, 'session cleared');
  ok(sawChange === null, 'onSessionChange registered without throwing');
}

console.log(bad ? `\n${bad} failure(s)` : '\napi.js verified against a simulated-RLS backend');
process.exit(bad ? 1 : 0);
