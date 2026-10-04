// Temporary: verify the event marker + filter round-trips through the data
// layer, including that rows written before the migration still load.
import { makeFakeClient } from './fake-supabase.mjs';
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {},
  clear: () => {}, key: () => null, length: 0 };
const { createServer } = await import('vite');
const server = await createServer({ configFile: 'vite.config.js', server: { middlewareMode: true },
  appType: 'custom', logLevel: 'error' });
const M = await server.ssrLoadModule('/src/api.js');
await server.close();

let bad = 0;
const ok = (c, l) => { if (!c) { console.log(`  FAIL ${l}`); bad++; } };
const eq = (a, b, l) => { if (a !== b) { console.log(`  FAIL ${l}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); bad++; } };

console.log('mapping:');
const row = M.taskToRow({ id: 't1', areaId: 'career', title: 'X', description: '',
  status: 'todo', isEvent: true, createdAt: 1, modifiedAt: 2, deadlineAt: null }, 'u1');
eq(row.is_event, true, 'isEvent -> is_event');
eq(M.taskToRow({ id: 't2', areaId: 'a', title: 'Y', isEvent: false }, 'u1').is_event, false, 'false stays false');
// A task saved by an older build has no isEvent at all.
eq(M.taskToRow({ id: 't3', areaId: 'a', title: 'Z' }, 'u1').is_event, false, 'missing isEvent defaults to false');
eq(M.rowToTask({ id: 't4', area_id: 'a', title: 'A', status: 'todo',
  is_event: true, created_at: '2026-01-01T00:00:00Z', modified_at: '2026-01-01T00:00:00Z',
  completed_at: null, deadline_at: null }).isEvent, true, 'is_event -> isEvent');
// The important one: a row from before the migration has no column.
eq(M.rowToTask({ id: 't5', area_id: 'a', title: 'B', status: 'todo',
  created_at: '2026-01-01T00:00:00Z', modified_at: '2026-01-01T00:00:00Z',
  completed_at: null, deadline_at: null }).isEvent, false,
  'pre-migration row (no is_event) reads as false, not undefined');

console.log('round trip through the store:');
const client = makeFakeClient();
const api = M.createApi(client);
const base = { id: 't6', areaId: 'health', title: 'Dentist', description: '',
  status: 'todo', createdAt: 1, modifiedAt: 1, completedAt: null, deadlineAt: 3 };
await api.createTask({ ...base, isEvent: true });
const h = await api.hydrate();
const stored = h.data.taskData.health.find((t) => t.id === 't6');
ok(!!stored, 'task stored');
eq(stored.isEvent, true, 'isEvent survives a database round trip');
eq(client.__tables.tasks[0].is_event, true, 'column written as is_event');
// Toggle it back off.
await api.createTask({ ...base, isEvent: false });
const h2 = await api.hydrate();
eq(h2.data.taskData.health.find((t) => t.id === 't6').isEvent, false, 'toggling off persists');
eq(client.__tables.tasks.length, 1, 'still one row, upsert not insert');

console.log('RLS still applies to the new column:');
const c2 = makeFakeClient({ userId: 'u1', seed: { tasks: [
  { user_id: 'u2', id: 'x', area_id: 'a', title: 'theirs', status: 'todo', is_event: true,
    created_at: '2026-01-01T00:00:00Z', modified_at: '2026-01-01T00:00:00Z', completed_at: null, deadline_at: null }
] } });
const h3 = await M.createApi(c2).hydrate();
eq(JSON.stringify(Object.keys(h3.data.taskData)), '[]', "another user's tasks stay hidden");

console.log(bad ? `\n${bad} failure(s)` : '\nevent flag maps, round-trips and stays behind RLS');
process.exit(bad ? 1 : 0);
