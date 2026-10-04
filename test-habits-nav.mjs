// Temporary: verify the daily "Habits" mini-card navigates to the Habits
// view (it used to call the task handler, which went to Areas).
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

let bad = 0;
const must = (c, m) => { if (!c) { console.log(`  FAIL ${m}`); bad++; } };
const tick = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

const host = document.createElement('div');
document.body.appendChild(host);

// Seed BEFORE mounting: the app hydrates once at mount, so a row inserted
// afterwards would never reach its state. The Daily view groups tasks by
// deadline horizon only, so it needs one landing on today.
const shim = await server.ssrLoadModule('/src/__api-shim.js');
const client = shim.__client;
const due = new Date();
due.setHours(23, 59, 0, 0);
client.__tables.tasks.push({
  user_id: client.__USER,
  id: 't_nav',
  area_id: 'career', // must be a real area id, or the app drops the task
  title: 'Route probe',
  description: '',
  status: 'todo',
  created_at: new Date().toISOString(),
  modified_at: new Date().toISOString(),
  completed_at: null,
  deadline_at: due.toISOString()
});

createRoot(host).render(React.createElement((await server.ssrLoadModule('/src/__app.jsx')).default));
await tick(500);

const $ = (s) => host.querySelector(s);
const $$ = (s) => [...host.querySelectorAll(s)];
const nav = (label) => $$('.nav-pill').find((b) => b.textContent.trim() === label);

console.log('1. the habits mini-card is on the Daily view');
must(!!$('.daily-view'), 'daily view is showing by default');
const mini = $('.daily-habits-mini');
must(!!mini, 'habits mini card present');
console.log(`   card reads: "${mini.textContent.replace(/\s+/g, ' ').trim()}"`);

console.log('\n2. clicking it goes to Habits, NOT Areas');
click(mini); await tick(350);
must(!!$('.habits-view'), 'now on the Habits view');
must(!$('.areas-view'), 'did NOT land on Areas');
console.log('   landed on Habits');

console.log('\n3. the task rows still route to Areas (that path is unchanged)');
click(nav('Daily')); await tick(400);
console.log(`   deadline rows on Daily: ${$$('.daily-task-row').length}`);
const row = $$('.daily-task-row').find((r) => r.textContent.includes('Route probe'));
must(!!row, 'the seeded task row is rendered on Daily');
if (row) {
  click(row); await tick(400);
  must(!!$('.areas-view'), 'clicking a task row goes to Areas');
  must(!$('.habits-view'), 'and not Habits');
  console.log('   task row -> Areas, unchanged');
}

await server.close();
unlinkSync('src/__app.jsx');
unlinkSync('src/__api-shim.js');
console.log(bad ? `\n${bad} failure(s)` : '\nhabits card routes to Habits, task rows still route to Areas');
process.exit(bad ? 1 : 0);
