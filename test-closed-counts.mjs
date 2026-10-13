// Confirms the Tasks view counts only OPEN work: a completed or rejected task
// must not appear in the filter badges, the "N open" total, or the area pill.
//
// Seeds four tasks in one area -- two open (one event, one plain) and two
// closed (one done event, one rejected event) -- so every count below has a
// value that only comes out right if the closed pair is excluded.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
}
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem: () => {},
  removeItem: () => {}, clear: () => {}, key: () => null, length: 0 }, configurable: true, writable: true });
class FakeRO {
  constructor(cb) { this.cb = cb; }
  observe(el) { this.cb([{ target: el, contentRect: { width: 900, height: 220, top: 0, left: 0 } }], this); }
  unobserve() {} disconnect() {}
}
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

const now = new Date().toISOString();
const due = new Date();
due.setHours(23, 59, 0, 0);

// Four tasks, one area: 2 open, 2 closed.
const seed = [
  ['t_open_evt', 'Dentist appointment', true, 'todo', null],
  ['t_open_pln', 'Read a book', false, 'in_progress', null],
  ['t_done_evt', 'Team retro', true, 'done', now],
  ['t_rej_evt', 'Abandoned thing', true, 'rejected', null]
];
for (const [id, title, isEvent, status, completedAt] of seed) {
  client.__tables.tasks.push({
    user_id: client.__USER, id, area_id: 'health', title, description: '',
    status, is_event: isEvent, created_at: now, modified_at: now,
    completed_at: completedAt, deadline_at: due.toISOString()
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
const filterBtn = (label) =>
  $$('.area-filter-btn').find((b) => b.textContent.trim().startsWith(label));

console.log('1. the view is reached from the Tasks nav pill');
click(nav('Tasks')); await tick(400);
must(!!$('.areas-view'), 'Tasks view rendered');
must(!!nav('Tasks'), 'nav pill is labelled Tasks');

console.log('\n2. all four rows still exist (closing hides nothing)');
must($$('.task-row-data').length === 4, `all 4 tasks listed, got ${$$('.task-row-data').length}`);
console.log(`   rows rendered: ${$$('.task-row-data').length}`);

console.log('\n3. the "N open" total excludes done and rejected');
const openTotal = $('.area-count')?.textContent.trim();
must(openTotal === '2 open', `header says "2 open", got "${openTotal}"`);
console.log(`   header total: "${openTotal}"`);

console.log('\n4. filter badges count only open tasks');
// There are 3 events in the seed but only 1 is open; 2 tasks, 1 open.
const badges = $$('.area-filter-btn')
  .map((b) => `${b.textContent.trim()}=${b.querySelector('.area-filter-count')?.textContent ?? '-'}`)
  .join('  ');
const eventsBadge = filterBtn('Events')?.querySelector('.area-filter-count')?.textContent.trim();
const tasksBadge = filterBtn('Tasks')?.querySelector('.area-filter-count')?.textContent.trim();
must(eventsBadge === '1', `Events badge is 1 (not 3), got ${eventsBadge}`);
must(tasksBadge === '1', `Tasks badge is 1 (not 2), got ${tasksBadge}`);
console.log(`   badges: ${badges}`);

console.log('\n5. the area pill count excludes closed tasks');
// Health holds all four: 2 open, so the pill reads 2 and not 4.
const healthPill = $$('.area-card').find((b) => b.textContent.includes('Health'));
const pillMeta = healthPill?.querySelector('.area-card-meta')?.textContent.trim();
must(pillMeta === '2', `Health pill shows 2, got "${pillMeta}"`);
console.log(`   Health pill: "${pillMeta}"`);

console.log('\n6. filtering still shows the full list for that kind');
click(filterBtn('Events')); await tick(300);
must($$('.task-row-data').length === 3, `Events shows all 3 event rows, got ${$$('.task-row-data').length}`);
must($('.area-count')?.textContent.trim() === '1 open', 'but only 1 of them is open');
click(filterBtn('Tasks')); await tick(300);
must($$('.task-row-data').length === 1, `Tasks shows 1 row, got ${$$('.task-row-data').length}`);
must($('.area-count')?.textContent.trim() === '1 open', 'Tasks open count is 1');
click(filterBtn('All')); await tick(300);
must($$('.task-row-data').length === 4, 'All returns to 4 rows');
console.log('   badge and list intentionally differ: lists show history, counts show work left');

await server.close();
unlinkSync('src/__app.jsx');
unlinkSync('src/__api-shim.js');
console.log(bad ? `\n${bad} failure(s)` : '\nclosed tasks excluded from every count');
process.exit(bad ? 1 : 0);