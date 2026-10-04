// Temporary: exercise the new mobile menu and confirm the desktop nav is
// still intact. jsdom does not apply media queries, so the CSS breakpoints
// cannot be exercised here — this covers the behaviour, not the layout.
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
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'KeyboardEvent']) {
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
createRoot(host).render(React.createElement((await server.ssrLoadModule('/src/__app.jsx')).default));
await tick(500);

const $ = (s) => host.querySelector(s);
const $$ = (s) => [...host.querySelectorAll(s)];

console.log('1. menu starts closed, and the desktop nav is untouched');
must(!$('.mobile-menu'), 'menu closed initially');
must($$('.topnav .nav-pill').length === 4, 'desktop nav still has 4 pills');
must(!!$('.menu-toggle'), 'menu toggle present in the DOM');
console.log('   menu closed, 4 desktop nav pills intact');

console.log('\n1a. header row order: brand, then nav, then date');
// The date chip and "today" were moved out of the nav row. Assert the
// structural order so it cannot drift back.
const headerEl = $('.header');
const rows = [...headerEl.children].map((c) =>
  c.className.split(' ').filter((x) => !x.startsWith('is-')).join('.')
);
console.log(`   header children: ${JSON.stringify(rows)}`);
must(rows[0].includes('header-top'), 'first row is the brand/actions row');
must(rows[1] === 'topnav', 'second row is the nav');
must(rows[2].includes('header-date'), 'third row is the date row');
must(!!$('.header-date .date-chip'), 'date chip lives in the date row');
must(!$('.topnav .date-chip'), 'date chip is NOT inside the nav');
must(!!$('.header-actions .signout-btn'), 'sign out lives in the actions row');
must($$('.topnav > .nav-pill').length === 4, 'nav contains only the four pills');
// Sticky is what makes the nav persist.
must(
  /\.header \{[^}]*position: sticky/.test(
    readFileSync('src/styles.css', 'utf8').replace(/\s+/g, ' ')
  ),
  'header is position: sticky'
);
console.log('   order correct, header is sticky');

console.log('\n1b. menu is NOT nested inside the header');
// The header has backdrop-filter, which makes it the containing block for
// position:fixed children. A panel nested inside it gets clipped to the
// header box. This is the assertion that catches that regression.
const header = $('.header');
must(!!header, 'header present');
must(!header.querySelector('.mobile-menu'), 'menu is not a descendant of .header');
must(!header.querySelector('.menu-backdrop'), 'backdrop is not a descendant of .header');
must(
  !/backdrop-filter|filter|transform/.test(
    (header.getAttribute('style') || '')
  ),
  'no inline filter on the header'
);
console.log('   menu and backdrop live outside .header');

console.log('\n2. toggle opens the menu with all four views');
click($('.menu-toggle')); await tick();
const menu = $('.mobile-menu');
must(!!menu, 'menu opened');
must($$('.mobile-menu-item').length >= 4, `menu has view items, got ${$$('.mobile-menu-item').length}`);
const labels = $$('.mobile-menu-item').map((b) => b.textContent.trim());
console.log(`   menu items: ${JSON.stringify(labels)}`);
must(labels.includes('Daily') && labels.includes('Habits') && labels.includes('Areas') && labels.includes('Journal'),
  'all four views in the menu');
must(labels.some((l) => l.includes('Sign out')), 'sign out in the menu');
const active = $('.mobile-menu-item.is-active');
must(!!active, 'current view marked active');
must(active.textContent.trim() === 'Daily', 'Daily is active by default');
must($('.menu-toggle').getAttribute('aria-expanded') === 'true', 'aria-expanded set');

console.log('\n2b. sign out is an icon, with an accessible name');
const signOutItem = $$('.mobile-menu-item').find((b) => b.textContent.includes('Sign out'));
must(!!signOutItem, 'sign out item found');
const icon = signOutItem.querySelector('.signout-icon');
must(!!icon, 'sign out uses the .signout-icon glyph');
must(icon.getAttribute('aria-hidden') === 'true', 'glyph is aria-hidden');
must(signOutItem.textContent.includes('Sign out'), 'still has a text label alongside');
console.log('   sign out: icon + text, icon hidden from a11y tree');

console.log('\n3. choosing a view navigates and closes the menu');
const areasItem = $$('.mobile-menu-item').find((b) => b.textContent.trim() === 'Areas');
click(areasItem); await tick(300);
must(!$('.mobile-menu'), 'menu closed after choosing');
must($('.menu-toggle').getAttribute('aria-expanded') === 'false', 'aria-expanded reset');
must(!!$('.areas-view'), 'now on the Areas view');
console.log('   navigated to Areas, menu closed');

console.log('\n4. Escape closes the menu');
click($('.menu-toggle')); await tick();
must(!!$('.mobile-menu'), 'reopened');
dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await tick(200);
must(!$('.mobile-menu'), 'Escape closed the menu');
console.log('   Escape works');

console.log('\n5. backdrop click closes the menu');
click($('.menu-toggle')); await tick();
must(!!$('.menu-backdrop'), 'backdrop present when open');
click($('.menu-backdrop')); await tick(200);
must(!$('.mobile-menu'), 'backdrop click closed it');
console.log('   backdrop click works');

console.log('\n6. sign out from the menu returns to the gate');
click($('.menu-toggle')); await tick();
const out = $$('.mobile-menu-item').find((b) => b.textContent.includes('Sign out'));
must(!!out, 'sign out item present');
click(out); await tick(500);
must(!!$('.signin-screen'), 'back at the sign-in gate');
must(!$('.topnav'), 'app chrome gone');
console.log('   signed out, gate shown');

await server.close();
unlinkSync('src/__app.jsx');
unlinkSync('src/__api-shim.js');
console.log(bad ? `\n${bad} failure(s)` : '\nmobile menu behaviour verified');
process.exit(bad ? 1 : 0);
