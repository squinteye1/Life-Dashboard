// Temporary: prove the sign-in form works and that data actually survives a
// page reload by coming back out of the backend, not out of memory.
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

globalThis.__TEST_SIGNED_IN__ = false; // start signed out
writeFileSync('src/__api-shim.js', `
import { createApi } from './api.js';
import { makeFakeClient } from '../fake-supabase.mjs';
// One shared client across mounts, standing in for the server surviving a reload.
const client = globalThis.__FAKE__ || (globalThis.__FAKE__ = makeFakeClient({ signedIn: false }));
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
const must = (c, m) => { if (!c) { console.log('  FAIL ' + m); bad++; } };
const tick = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
function setInput(el, v) {
  const proto = Object.getPrototypeOf(el);
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}
async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  createRoot(host).render(React.createElement((await server.ssrLoadModule('/src/__app.jsx')).default));
  await tick(500);
  return host;
}

console.log('1. sign-in gate, then sign in through the form');
let host = await mount();
const $ = (s) => host.querySelector(s);
const $$ = (s) => [...host.querySelectorAll(s)];
must(!!$('.signin-screen'), 'sign-in screen shown when signed out');
must(!$('.topnav'), 'app hidden when signed out');
console.log('   signed out, gate shown');

const email = $('.signin-input[type="email"]');
const pass = $('.signin-input[type="password"]');
must(!!email && !!pass, 'email and password fields present');
setInput(email, 'me@example.com');
setInput(pass, 'hunter2hunter2');
await tick(50);
click($('.signin-submit'));
await tick(600);
must(!!$('.topnav'), 'app shown after sign in');
must(!$('.signin-screen'), 'gate gone after sign in');
must(!!$('.daily-view'), 'daily view rendered after sign in');
console.log('   signed in, app loaded');

console.log('\n2. bad credentials show an error and do not enter the app');
await client.auth.signOut();
host = await mount();
setInput(host.querySelector('.signin-input[type="email"]'), 'nobody@example.invalid');
setInput(host.querySelector('.signin-input[type="password"]'), 'wrongpassword');
await tick(50);
// Make the fake reject these credentials, as Supabase would.
const realSignIn = client.auth.signInWithPassword.bind(client.auth);
client.auth.signInWithPassword = async () => ({
  data: { user: null },
  error: { message: 'Invalid login credentials' }
});
click(host.querySelector('.signin-submit'));
await tick(500);
const err = host.querySelector('.signin-error');
must(!!err, 'sign-in error shown');
must(err && err.textContent.includes('Invalid login credentials'), 'error names the problem');
must(!host.querySelector('.topnav'), 'still signed out after a bad password');
console.log(`   error: "${err && err.textContent}"`);
client.auth.signInWithPassword = realSignIn;

console.log('\n3. write data, then reload the whole app and read it back');
host = await mount();
setInput(host.querySelector('.signin-input[type="email"]'), 'me@example.com');
setInput(host.querySelector('.signin-input[type="password"]'), 'hunter2hunter2');
await tick(50);
click(host.querySelector('.signin-submit'));
await tick(600);
must(!!host.querySelector('.topnav'), 'signed in again');

// Journal entry
const nav = (h, label) => [...h.querySelectorAll('.nav-pill')].find((b) => b.textContent.trim() === label);
click(nav(host, 'Journal')); await tick(300);
const ta = host.querySelector('.journal-textarea');
setInput(ta, 'persisted thought'); await tick(50);
click(host.querySelector('.save-btn')); await tick(400);

// Weight
click(nav(host, 'Daily')); await tick(300);
click(host.querySelector('.daily-checkin-card')); await tick(250);
setInput(host.querySelector('input[aria-label="Weight in kilograms"]'), '79.6'); await tick(50);
click(host.querySelector('.task-drawer-save')); await tick(400);

// Habit toggle
click(nav(host, 'Habits')); await tick(300);
const habit = host.querySelector('.habit-card');
click(habit); await tick(300);

const before = {
  journal: client.__tables.journal_entries.length,
  weights: client.__tables.weights.length,
  logs: client.__tables.habit_logs.length
};
must(before.journal === 1 && before.weights === 1 && before.logs === 1,
  `all three writes landed (${JSON.stringify(before)})`);
console.log(`   wrote journal=${before.journal} weight=${before.weights} habit=${before.logs}`);

// Full reload: new client instance reads from the same "server".
console.log('\n4. reload — data comes back from the backend');
const host2 = await mount();
const $2 = (s) => host2.querySelector(s);
must(!!$2('.topnav'), 'still signed in after reload (session persisted)');
must(!$2('.signin-screen'), 'no gate after reload');
must(!!$2('.daily-view'), 'daily view after reload');

// Weight must be back on the card, read from the backend.
const cardText = $2('.daily-checkin-card').textContent.replace(/\s+/g, ' ');
must(cardText.includes('79.6 kg'), `weight restored, got: ${cardText.slice(0, 140)}`);
console.log(`   weight after reload: ${cardText.match(/weight[^a-z]*([\d.]+ kg)/)?.[0] || 'NOT FOUND'}`);

// Journal must be back.
click([...host2.querySelectorAll('.nav-pill')].find((b) => b.textContent.trim() === 'Journal'));
await tick(350);
const ta2 = host2.querySelector('.journal-textarea');
must(ta2.value === 'persisted thought', `journal restored, got "${ta2.value}"`);
console.log(`   journal after reload: "${ta2.value}"`);

// Habit must be back.
click([...host2.querySelectorAll('.nav-pill')].find((b) => b.textContent.trim() === 'Habits'));
await tick(350);
const checked = host2.querySelectorAll('.habit-card.is-checked').length;
must(checked === 1, `one habit checked after reload, got ${checked}`);
console.log(`   habits checked after reload: ${checked}`);

await server.close();
unlinkSync('src/__app.jsx');
unlinkSync('src/__api-shim.js');
console.log(bad ? `\n${bad} failure(s)` : '\nsign-in flow and reload persistence verified');
process.exit(bad ? 1 : 0);
