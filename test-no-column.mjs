// Temporary: prove the app still works against a database that does NOT yet
// have the is_event column, i.e. before the migration has been applied.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {},
  clear: () => {}, key: () => null, length: 0 };
class FakeRO { constructor(cb){this.cb=cb;} observe(el){this.cb([{target:el,contentRect:{width:900,height:220,top:0,left:0}}],this);} unobserve(){} disconnect(){} }
for (const k of ['window','document','Element','HTMLElement','SVGElement','Node','getComputedStyle','requestAnimationFrame','cancelAnimationFrame'])
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 }, configurable: true, writable: true });
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
// A backend that DROPS unknown columns, the way PostgREST reports a missing
// column (PGRST204) rather than returning an error for the whole query.
const raw = makeFakeClient({ signedIn: true });
const client = {
  __state: raw.__state, __tables: raw.__tables, __USER: raw.__USER,
  auth: raw.auth,
  from(name) {
    const b = raw.from(name);
    if (name !== 'tasks') return b;
    const strip = (d) => Array.isArray(d) ? d.map(({ is_event, ...rest }) => rest) : d;
    for (const m of ['select', 'upsert', 'insert']) {
      const orig = b[m].bind(b);
      b[m] = (...a) => ({ ...b, then: (ok, err) => orig(...a).then((r) => ok({ ...r, data: strip(r.data) })) });
    }
    return b;
  }
};
export const api = (options = {}) => createApi(client, options);
export const isConfigured = true;
export const __client = client;
`);
const now = new Date().toISOString();
writeFileSync('src/__app.jsx', readFileSync('src/App.jsx', 'utf8').replace("from './api.js'", "from './__api-shim.js'"));

const { createServer } = await import('vite');
const server = await createServer({ configFile: 'vite.config.js', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const shim = await server.ssrLoadModule('/src/__api-shim.js');
const due = new Date(); due.setHours(23, 59, 0, 0);
shim.__client.__tables.tasks.push({ user_id: shim.__client.__USER, id: 't_old', area_id: 'health',
  title: 'Legacy task', description: '', status: 'todo', created_at: now, modified_at: now,
  completed_at: null, deadline_at: due.toISOString() });

const host = document.createElement('div');
document.body.appendChild(host);
createRoot(host).render(React.createElement((await server.ssrLoadModule('/src/__app.jsx')).default));
await new Promise((r) => setTimeout(r, 500));

let bad = 0;
const must = (c, m) => { if (!c) { console.log(`  FAIL ${m}`); bad++; } };
const $ = (s) => host.querySelector(s);
const $$ = (s) => [...host.querySelectorAll(s)];
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const tick = (ms = 250) => new Promise((r) => setTimeout(r, ms));

console.log('app loads and renders with no is_event column at all:');
must(!!$('.topnav'), 'app chrome rendered, no crash');
must($$('.nav-pill').length === 4, 'nav intact');
click($$('.nav-pill').find((b) => b.textContent.trim() === 'Areas')); await tick(350);
must($$('.task-row-data').length === 1, `legacy task still listed, got ${$$('.task-row-data').length}`);
must(!$$('.task-row-data')[0].querySelector('.task-event-marker'), 'no marker on a legacy task');
const filter = $$('.area-filter-btn').find((b) => b.textContent.trim().startsWith('Tasks'));
click(filter); await tick(250);
must($$('.task-row-data').length === 1, 'Tasks filter still shows the legacy task');
console.log('   legacy task renders, no marker, filters work');

console.log('\nopening and saving it does not throw:');
click($$('.task-row-data')[0]); await tick(300);
must(!!$('.task-drawer'), 'drawer opens');
const evt = $$('.task-drawer-event-btn').find((b) => b.textContent.includes('Event'));
click(evt); await tick(150);
click($('.task-drawer-save')); await tick(400);
// The Tasks filter correctly hides it now it is marked as an event.
must($$('.task-row-data').length === 0, 'Tasks filter hides it once marked as an event');
// Switch to Events: it should be there, marked, and nothing threw.
click($$('.area-filter-btn').find((b) => b.textContent.trim().startsWith('Events')));
await tick(300);
must($$('.task-row-data').length === 1, 'Events filter shows it');
must(!!$$('.task-row-data')[0].querySelector('.task-event-marker'),
  'marker renders in the UI (even though the column is not persisted)');
console.log('   saved without error; filter and marker still work, only the write is dropped');

await server.close();
unlinkSync('src/__app.jsx');
unlinkSync('src/__api-shim.js');
console.log(bad ? `\n${bad} failure(s)` : '\napp degrades gracefully before the migration is applied');
process.exit(bad ? 1 : 0);
