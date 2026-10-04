// Temporary: drive the real app to confirm the event marker, the drawer
// toggle and the All/Events/Tasks filter all work together.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {},
  clear: () => {}, key: () => null, length: 0 };
class FakeRO {
  constructor(cb) { this.cb = cb; }
  observe(el) { this.cb([{ target: el, contentRect: { width: 900, height: 220, top: 0, left: 0 } }], this); }
  unobserve() {} disconnect() {}
}
for (const k of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
}
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem: () => {},
  removeItem: () => {}, clear: () => {}, key: () => null, length: 0 }, configurable: true, writable: true });
Object.defineProperty(globalThis, 'ResizeObserver', { value: FakeRO, configurable: true, writable: true });
Object.defineProperty(dom.window, 'ResizeObserver', { value: FakeRO, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
const box = { width: 900, height: 220, top: 0, left: 0, right: 900, bottom: 220, x: 0, y: 0 };
dom.window.Element.prototype.getBoundingClientRect = () => box;
Object.defineProperty(dom.window.Element.prototype, 'offsetWidth', { get: () => 900 });
Object.defineProperty(dom.window.Element.prototype, 'offsetHeight', { get: () => 220 });

globalThis.__TEST_SIGNED_IN__ = true;
writeFileSync('src/__api-shim.js', `
import { createApi } from './api.js';
import { makeFakeClient } from '../fake-supabase.mjs';
const client = makeFakeClient({ signedIn: true });
export const api = (options = {}) => createApi(client, options);
export const isConfigured = true;
export const __client = client;
`);
const src = readFileSync('src/App.jsx', 'utf8').replace("from './api.js'", "from './__api-shim.js'");
writeFileSync('src/__app.jsx', src);

const { createServer } = await import('vite');
const server = await createServer({ configFile: 'vite.config.js', server: { middlewareMode: true },
  appType: 'custom', logLevel: 'error' });
const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const shim = await server.ssrLoadModule('/src/__api-shim.js');
const client = shim.__client;

// Seed two tasks: one event, one plain task, both in the same area.
const due = new Date();
due.setHours(23, 59, 0, 0);
const now = new Date().toISOString();
for (const [id, title, isEvent] of [['t_evt', 'Dentist appointment', true], ['t_pln', 'Read a book', false]]) {
  client.__tables.tasks.push({
    user_id: client.__USER, id, area_id: 'health', title, description: 'details here',
    status: 'todo', is_event: isEvent, created_at: now, modified_at: now,
    completed_at: null, deadline_at: due.toISOString()
  });
}

const host = document.createElement('div');
document.body.appendChild(host);
createRoot(host).render(React.createElement((await server.ssrLoadModule('/src/__app.jsx')).default));
await new Promise((r) => setTimeout(r, 500));

let bad = 0;
const must = (c, m) => { if (!c) { console.log(`  FAIL ${m}`); bad++; } };
const tick = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const $ = (s) => host.querySelector(s);
const $$ = (s) => [...host.querySelectorAll(s)];
const nav = (label) => $$('.nav-pill').find((b) => b.textContent.trim() === label);
const byText = (sel, t) => $$(sel).find((b) => b.textContent.trim() === t);

console.log('1. marker shows on the event row only');
click(nav('Areas')); await tick(350);
const rows = $$('.task-row-data');
must(rows.length === 2, `two rows rendered, got ${rows.length}`);
const evtRow = rows.find((r) => r.textContent.includes('Dentist'));
const plnRow = rows.find((r) => r.textContent.includes('Read a book'));
must(!!evtRow && !!evtRow.querySelector('.task-event-marker'), 'event row has the marker');
must(!!plnRow && !plnRow.querySelector('.task-event-marker'), 'plain task row has no marker');
console.log(`   marker on event only: ${!!evtRow?.querySelector('.task-event-marker')}`);

console.log('\n2. the filter narrows the list');
const filterBtn = (label) => byText('.area-filter-btn', label) ||
  $$('.area-filter-btn').find((b) => b.textContent.trim().startsWith(label));
must(!!filterBtn('All'), 'All filter present');
must(!!filterBtn('Events'), 'Events filter present');
must(!!filterBtn('Tasks'), 'Tasks filter present');
const count = $$('.area-filter-count')[0];
must(!!count && count.textContent.trim() === '1', `event count badge shows 1, got ${count?.textContent}`);
console.log(`   event count badge: ${count?.textContent}`);

click(filterBtn('Events')); await tick(300);
must($$('.task-row-data').length === 1, `Events shows 1 row, got ${$$('.task-row-data').length}`);
must($$('.task-row-data')[0].textContent.includes('Dentist'), 'and it is the event');
must(filterBtn('Events').classList.contains('is-active'), 'Events button is active');
console.log('   Events -> 1 row (the event)');

click(filterBtn('Tasks')); await tick(300);
must($$('.task-row-data').length === 1, `Tasks shows 1 row, got ${$$('.task-row-data').length}`);
must($$('.task-row-data')[0].textContent.includes('Read a book'), 'and it is the plain task');

click(filterBtn('All')); await tick(300);
must($$('.task-row-data').length === 2, `All shows 2 rows, got ${$$('.task-row-data').length}`);
console.log('   Tasks -> 1 row (the task); All -> 2 rows');

console.log('\n3. the drawer toggle persists through the database');
// Re-query: the rows captured earlier are detached after the filter clicks.
const plnFresh = $$('.task-row-data').find((r) => r.textContent.includes('Read a book'));
must(!!plnFresh, 'found the plain task row');
click(plnFresh); await tick(300);
must(!!$('.task-drawer'), 'drawer opened');
// The Event button's text includes its glyph, so match on substring.
const evtBtn = $$('.task-drawer-event-btn').find((b) => b.textContent.includes('Event'));
const taskBtn = $$('.task-drawer-event-btn').find((b) => b.textContent.trim() === 'Task');
must(!!evtBtn && !!taskBtn, 'Task / Event buttons present');
must(taskBtn.classList.contains('is-active'), 'defaults to Task');
click(evtBtn); await tick(150);
must(evtBtn.classList.contains('is-active'), 'Event becomes active');
must(!!byText('.daily-field-meta', 'Fixed time'), 'helper text updates to "Fixed time"');
click($('.task-drawer-save')); await tick(400);
const stored = client.__tables.tasks.find((t) => t.id === 't_pln');
must(stored.is_event === true, 'is_event written to the database');
must(client.__tables.tasks.length === 2, 'no new row created');
console.log(`   is_event for t_pln is now ${stored.is_event}`);
await tick(200);
must($$('.task-row-data').length === 2, `both rows now events, filter default still All: ${$$('.task-row-data').length}`);
must($$('.task-row-data').every((r) => r.querySelector('.task-event-marker')),
  'every row now shows a marker');

console.log('\n4. the Daily view shows the marker too');
click(nav('Daily')); await tick(350);
const dRows = $$('.daily-task-row');
must(dRows.length === 2, `two deadline rows on Daily, got ${dRows.length}`);
must(dRows.every((r) => r.querySelector('.task-event-marker')), 'Daily rows carry the marker');
console.log(`   ${dRows.length} daily rows, all marked`);

await server.close();
unlinkSync('src/__app.jsx');
unlinkSync('src/__api-shim.js');
console.log(bad ? `\n${bad} failure(s)` : '\nevent marker, filter and drawer toggle verified');
process.exit(bad ? 1 : 0);
