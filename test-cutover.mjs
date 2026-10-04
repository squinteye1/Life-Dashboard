// Temporary: drive the real app in jsdom against the fake Supabase backend.
// Verifies the sign-in gate, hydrate, that each user action fires exactly one
// network write, and that a failed write surfaces instead of vanishing.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {},
  clear: () => {}, key: () => null, length: 0 };
const ls = {
  getItem: (k) => (dom.window.localStorage.getItem(k)),
  setItem: (k, v) => dom.window.localStorage.setItem(k, v),
  removeItem: (k) => dom.window.localStorage.removeItem(k),
  clear: () => dom.window.localStorage.clear(),
  key: () => null,
  length: 0
};
class FakeRO {
  constructor(cb) { this.cb = cb; }
  observe(el) { this.cb([{ target: el, contentRect: { width: 900, height: 220, top: 0, left: 0 } }], this); }
  unobserve() {} disconnect() {}
}
for (const k of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
}
Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
Object.defineProperty(globalThis, 'ResizeObserver', { value: FakeRO, configurable: true, writable: true });
Object.defineProperty(dom.window, 'ResizeObserver', { value: FakeRO, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
const box = { width: 900, height: 220, top: 0, left: 0, right: 900, bottom: 220, x: 0, y: 0 };
dom.window.Element.prototype.getBoundingClientRect = () => box;
Object.defineProperty(dom.window.Element.prototype, 'offsetWidth', { get: () => 900 });
Object.defineProperty(dom.window.Element.prototype, 'offsetHeight', { get: () => 220 });

// Point the app at a shim that swaps Supabase for the in-memory fake.
// Aliasing matters: installing the fake on Node's copy of api.js does
// nothing, because Vite loads its own module instance.
globalThis.__TEST_SIGNED_IN__ = process.env.SIGNED_IN !== '0';
writeFileSync('src/__api-shim.js', `
import { createApi } from './api.js';
import { makeFakeClient } from '../fake-supabase.mjs';
const client = makeFakeClient({ signedIn: globalThis.__TEST_SIGNED_IN__ !== false });
// Forward the caller's options, notably onError, so the app can surface
// failed writes. A pre-built instance would swallow the callback.
export const api = (options = {}) => createApi(client, options);
export const isConfigured = true;
export const __client = client;
`);
const src = readFileSync('src/App.jsx', 'utf8')
  .replace("from './api.js'", "from './__api-shim.js'");
writeFileSync('src/__app.jsx', src);
const { createServer } = await import('vite');
const server = await createServer({ configFile: 'vite.config.js', server: { middlewareMode: true },
  appType: 'custom', logLevel: 'error' });
const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const shim = await server.ssrLoadModule('/src/__api-shim.js');
const client = shim.__client;

let bad = 0;
const must = (c, m) => { if (!c) { console.log('  FAIL ' + m); bad++; } };
const tick = (ms = 250) => new Promise((r) => setTimeout(r, ms));

const host = document.createElement('div');
document.body.appendChild(host);
const errors = [];
const origErr = console.error;
console.error = (...a) => { errors.push(a.join(' ')); origErr(...a); };
createRoot(host).render(React.createElement((await server.ssrLoadModule('/src/__app.jsx')).default));
await tick(500);
console.error = origErr;

const $ = (s) => host.querySelector(s);
const $$ = (s) => [...host.querySelectorAll(s)];
const byText = (s, t) => $$(s).find((e) => e.textContent.trim() === t);
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
function setInput(el, v) {
  // Use the element's own prototype: the journal is a textarea, the weight
  // field is an input.
  const proto = Object.getPrototypeOf(el);
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}
const writes = (table) => client.__state.calls.filter((c) => c.op !== 'select' && c.table === table).length;

console.log('1. signed out shows the sign-in gate, not the app');
if (process.env.SIGNED_IN === '0') {
  must(!!$('.signin-screen'), 'sign-in screen shown when signed out');
  must(!$('.topnav'), 'app chrome hidden when signed out');
  must(!$('.daily-view'), 'no daily view when signed out');
  console.log('   sign-in gate present');
} else {
  must(!!$('.topnav'), 'app chrome shown when signed in');
  must(!$('.signin-screen'), 'no sign-in screen when signed in');
  must(!!$('.daily-view'), 'daily view rendered');
  must(!!$('.weight-card'), 'weight card rendered');
  const cells = $$('.heatmap-cell').length;
  must(cells === 371, `expected 371 heatmap cells, got ${cells}`);
  console.log(`   app loaded, ${cells} cells, habits seeded: ${client.__tables.habits.length}`);
  must(client.__tables.habits.length === 10, 'default habits seeded on first run');
}

console.log('\n2. each user action fires exactly one network write');
if (process.env.SIGNED_IN !== '0') {
  // Habit toggle. Per-habit rows live on the Habits view, so go there first.
  const navH = $$('.nav-pill').find((b) => b.textContent.trim() === 'Habits');
  must(!!navH, 'habits nav found');
  click(navH); await tick(300);
  const row = $('.habit-card');
  must(!!row, 'found a habit toggle');
  client.__state.calls.length = 0;
  if (row) { click(row); await tick(); }
  must(writes('habit_logs') === 1, `one habit toggle should be one write, got ${writes('habit_logs')}`);
  must(client.__tables.habit_logs.length === 1, 'habit log stored');
  console.log(`   habit toggle -> ${writes('habit_logs')} write, log stored`);

  // Typing in the journal must not write at all.
  client.__state.calls.length = 0;
  const nav = $$('.nav-pill').find((b) => b.textContent.trim() === 'Journal');
  must(!!nav, 'journal nav found');
  click(nav); await tick();
  const ta = $('.journal-textarea');
  must(!!ta, 'journal textarea present');
  const jBefore = writes('journal_entries');
  for (const ch of ['h', 'e', 'l', 'l', 'o']) { setInput(ta, ta.value + ch); await tick(30); }
  const jDuring = writes('journal_entries');
  must(jDuring - jBefore === 0, `typing must not write, got ${jDuring - jBefore} writes`);
  console.log(`   5 keystrokes -> ${jDuring - jBefore} writes`);

  // Explicit save writes once.
  setInput(ta, 'hello world');
  await tick(50);
  click($('.save-btn'));
  await tick(300);
  const jAfter = writes('journal_entries');
  must(jAfter - jDuring === 1, `one save should be one write, got ${jAfter - jDuring}`);
  must(client.__tables.journal_entries.length === 1, 'entry stored');
  must(client.__tables.journal_entries[0].body === 'hello world', 'body stored');
  console.log(`   save -> ${jAfter - jDuring} write, body stored`);

  // Weight save writes once.
  const navD = $$('.nav-pill').find((b) => b.textContent.trim() === 'Daily');
  click(navD); await tick(300);
  client.__state.calls.length = 0;
  click($('.daily-checkin-card')); await tick();
  const kg = $('input[aria-label="Weight in kilograms"]');
  must(!!kg, 'weight input in drawer');
  setInput(kg, '82.4'); await tick(50);
  click($('.task-drawer-save')); await tick(300);
  must(writes('weights') === 1, `weight save should be one write, got ${writes('weights')}`);
  must(client.__tables.weights.length === 1, 'weight stored');
  console.log(`   weight save -> ${writes('weights')} write, kg=${client.__tables.weights[0].kg}`);

  // Unit toggle persists.
  client.__state.calls.length = 0;
  click(byText('.weight-unit-btn', 'st · lb')); await tick(300);
  must(writes('settings') === 1, `unit toggle should write once, got ${writes('settings')}`);
  must(client.__tables.settings[0].weight_unit === 'stlb', 'unit persisted');
  console.log(`   unit toggle -> ${writes('settings')} write, unit=stlb`);

  console.log('\n3. a failing write surfaces a banner instead of vanishing');
  // Break journal writes, then try to save.
  client.__state.failTable = 'journal_entries';
  click($$('.nav-pill').find((x) => x.textContent.trim() === 'Journal')); await tick(300);
  const ta2 = $('.journal-textarea');
  setInput(ta2, 'will fail'); await tick(50);
  click($('.save-btn')); await tick(400);
  const banner = $('.save-error-banner');
  must(!!banner, 'save failure banner shown');
  if (banner) console.log(`   banner: "${banner.textContent.replace(/\s+/g, ' ').trim().slice(0, 70)}"`);
  must(banner && banner.textContent.includes('network down'), 'banner names the failure');
  // And the failure must be dismissible.
  if (banner) {
    click($('.save-error-dismiss')); await tick(200);
    must(!$('.save-error-banner'), 'banner dismisses');
  }
  client.__state.failTable = null;
  console.log('   failure surfaced and dismissible');
}

must(!errors.some((e) => /is not defined|Cannot read/.test(e)),
  `console errors: ${errors.filter((e) => /is not defined|Cannot read/.test(e)).slice(0, 2).join(' | ')}`);

await server.close();
unlinkSync('src/__app.jsx');
unlinkSync('src/__api-shim.js');
console.log(bad ? `\n${bad} failure(s)` : '\nauth gate, hydrate, explicit writes and error surfacing verified');
process.exit(bad ? 1 : 0);
