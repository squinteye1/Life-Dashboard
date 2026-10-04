// Temporary: confirm the st·lb weight input works end to end, since it was
// reported as missing. Covers: unit toggle, the two fields appearing, the
// 14 lb carry, and persistence to the database in canonical kg.
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
const box = { width: 390, height: 844, top: 0, left: 0, right: 390, bottom: 844, x: 0, y: 0 };
dom.window.Element.prototype.getBoundingClientRect = () => box;
Object.defineProperty(dom.window.Element.prototype, 'offsetWidth', { get: () => 390 });
Object.defineProperty(dom.window.Element.prototype, 'offsetHeight', { get: () => 844 });

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

let bad = 0;
const must = (c, m) => { if (!c) { console.log(`  FAIL ${m}`); bad++; } };
const tick = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
function setInput(el, v) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v);
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

const host = document.createElement('div');
document.body.appendChild(host);
createRoot(host).render(React.createElement((await server.ssrLoadModule('/src/__app.jsx')).default));
await tick(500);
const $ = (s) => host.querySelector(s);
const $$ = (s) => [...host.querySelectorAll(s)];
const byText = (s, t) => $$(s).find((b) => b.textContent.trim() === t);

console.log('1. the unit toggle is reachable on the Daily view');
const kgBtn = byText('.weight-unit-btn', 'kg');
const stBtn = byText('.weight-unit-btn', 'st · lb');
must(!!kgBtn && !!stBtn, 'both unit buttons present');
must(stBtn.classList.contains('is-active'), 'st·lb is the default');
must(!kgBtn.classList.contains('is-active'), 'kg is not the default');
console.log('   toggle present, st·lb active by default');

console.log('\n2. default input is the two-field stones + pounds form');
click($('.daily-checkin-card')); await tick();
const stIn = $('input[aria-label="Weight in stones"]');
const lbIn = $('input[aria-label="Weight in pounds"]');
must(!!stIn && !!lbIn, 'BOTH stones and pounds fields shown by default');
must(!$('input[aria-label="Weight in kilograms"]'), 'no kg field in the default mode');
console.log('   stones + pounds fields shown');
setInput(stIn, '12');
setInput(lbIn, '4');
await tick(50);
click($('.task-drawer-save')); await tick(400);
// 12 st 4 lb = 172 lb
const stlbKg = Number(client.__tables.weights[0].kg);
must(Math.abs(stlbKg - 172 * 0.45359237) < 1e-6, `expected 172 lb in kg, got ${stlbKg}`);
must(client.__tables.settings.length === 0, 'no settings row written just by using the default');
console.log(`   12 st 4 lb -> ${stlbKg.toFixed(4)} kg stored`);

console.log('\n3. switching to kg gives a single field and prefills it');
click(kgBtn); await tick(400);
must(client.__tables.settings[0]?.weight_unit === 'kg', 'unit persisted to settings');
click($('.daily-checkin-card')); await tick(300);
const kgIn = $('input[aria-label="Weight in kilograms"]');
must(!!kgIn, 'kg field shown after switching');
must(!$('input[aria-label="Weight in stones"]'), 'no stones field in kg mode');
must(kgIn.value === '78.0', `prefilled 78.0 kg, got ${kgIn.value}`);
const cardText = $('.daily-checkin-card').textContent.replace(/\s+/g, ' ');
must(cardText.includes('78.0 kg'), 'card reads in kg after switching');
console.log(`   kg field, prefilled ${kgIn.value}`);

console.log('\n4. typing kg saves, and switching back preserves the value');
setInput(kgIn, '82.4'); await tick(50);
click($('.task-drawer-save')); await tick(400);
must(Math.abs(Number(client.__tables.weights[0].kg) - 82.4) < 1e-9, 'kg saved');
console.log(`   saved ${client.__tables.weights[0].kg} kg`);

console.log('\n5. back in st·lb, the same weight reads correctly');
click(stBtn); await tick(400);
click($('.daily-checkin-card')); await tick(300);
const st2 = $('input[aria-label="Weight in stones"]');
const lb2 = $('input[aria-label="Weight in pounds"]');
// 82.4 kg = 181.66 lb -> 182 lb -> 13 st 0 lb
must(st2.value === '13' && lb2.value === '0', `expected 13/0, got ${st2.value}/${lb2.value}`);
console.log(`   82.4 kg reads back as ${st2.value} st ${lb2.value} lb`);

console.log('\n6. an out-of-range pounds entry normalises rather than being rejected');
setInput(st2, '12');
setInput(lb2, '14'); // 12*14+14 = 182 = 13 st 0 lb
await tick(60);
click($('.task-drawer-save')); await tick(400);
const kg = Number(client.__tables.weights[0].kg);
must(Math.abs(kg - 182 * 0.45359237) < 1e-6, `expected 182 lb in kg, got ${kg}`);
must(kg.toFixed(2) === '82.55', 'stored in canonical kg, not stones');
console.log(`   12 st 14 lb -> ${kg.toFixed(4)} kg (carried, stored as kg)`);

console.log('\n7. reopening shows the normalised form');
click($('.daily-checkin-card')); await tick(300);
const st3 = $('input[aria-label="Weight in stones"]');
const lb3 = $('input[aria-label="Weight in pounds"]');
must(st3.value === '13' && lb3.value === '0', `normalised to 13/0, got ${st3.value}/${lb3.value}`);
console.log(`   reopened: ${st3.value} st ${lb3.value} lb`);

await server.close();
unlinkSync('src/__app.jsx');
unlinkSync('src/__api-shim.js');
console.log(bad ? `\n${bad} failure(s)` : '\nstones + pounds input verified end to end');
process.exit(bad ? 1 : 0);
