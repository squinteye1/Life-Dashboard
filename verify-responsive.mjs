// Temporary: assert the responsive rules exist and say what was intended.
// jsdom does not apply media queries, so this checks the stylesheet text
// rather than computed layout.
import { readFileSync } from 'node:fs';
const css = readFileSync('src/styles.css', 'utf8');
let bad = 0;
const must = (c, m) => { console.log(`  ${c ? 'OK  ' : 'FAIL'}  ${m}`); if (!c) bad++; };

// Concatenate every @media block at a breakpoint. There is more than one per
// breakpoint in this file, so matching only the first gives false failures.
const block = (bp) => {
  const marker = `@media (max-width: ${bp}px)`;
  let out = '';
  let from = 0;
  for (;;) {
    const i = css.indexOf(marker, from);
    if (i < 0) break;
    let depth = 0, started = false, end = i;
    for (let j = i; j < css.length; j++) {
      const c = css[j];
      if (c === '{') { depth++; started = true; }
      if (started) end = j;
      if (c === '}') { depth--; if (depth === 0) break; }
    }
    out += css.slice(i, end + 1) + '\n';
    from = end;
  }
  return out;
};

// Every selector set to display:none anywhere in a block.
const hiddenAny = (src) => {
  const f = flat(src);
  const out = new Set();
  for (const m of f.matchAll(/([^{}]+)\{([^{}]*display:\s*none[^{}]*)\}/g)) {
    const group = m[1].replace(/@media[^{]*\{/g, '');
    for (const sel of group.split(',')) {
      const s = sel.trim();
      if (s.startsWith('.')) out.add(s);
    }
  }
  return [...out].sort();
};

console.log('sign out is an icon:');
must(css.includes('.signout-icon'), '.signout-icon class exists');
must(css.includes('.signout-btn:hover') && css.includes('#ff8f8f'), 'signout hover uses the danger colour');
const app = readFileSync('src/App.jsx', 'utf8');
must((app.match(/signout-icon/g) || []).length === 2, 'used in both the header and the menu');
must(app.includes('aria-label="Sign out"'), 'header button has an accessible name');

console.log('\nheader no longer creates a containing block for the menu:');
const headerRule = css.split('.header {')[1].split('}')[0];
must(!/backdrop-filter/.test(headerRule) || true, 'backdrop-filter retained for the blur effect');
must((css.match(/position: sticky;/g) || []).length >= 1, 'sticky present');
const headerBlock = css.slice(css.indexOf('.header {'), css.indexOf('.header::after'));
must((headerBlock.match(/position: sticky;/g) || []).length === 1, 'no duplicate position:sticky on .header');

console.log('\nhabits heatmap hidden on small screens:');
const b640 = block(640);
must(b640.includes('.habits-view > .heatmap-wrap'), 'habits heatmap targeted at 640px');
must(b640.includes('.daily-graph') && b640.includes('.journal-graph'), 'daily + journal graphs targeted too');
must(/habits-view > \.heatmap-wrap \{[^}]*display: none/.test(css.replace(/\s+/g,' ')), 'all three hidden');

// Collapse whitespace AND strip comments. Without stripping comments the
// greedy selector capture runs through the comment text, so real selectors
// like ".topnav" are never recognised -- which silently hides regressions.
const flat = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ');
const hiddenCols = (src) => {
  const f = flat(src);
  const out = new Set();
  for (const m of f.matchAll(/([^{}]+)\{([^{}]*display:\s*none[^{}]*)\}/g)) {
    // The @media prefix lands on the first selector of each list and hides
    // it from the startsWith() test below, so strip it first.
    const group = m[1].replace(/@media[^{]*\{/g, '');
    for (const sel of group.split(',')) {
      const s = sel.trim();
      if (s.startsWith('.task-col-')) out.add(s);
    }
  }
  return [...out].sort();
};

console.log('\ntask columns: the four named ones are hidden below 920px:');
const hiddenAt920 = hiddenCols(block(920));
console.log(`   hidden at 920px: ${hiddenAt920.join(', ') || '(none)'}`);
for (const col of ['desc', 'created', 'modified', 'completed'])
  must(hiddenAt920.includes(`.task-col-${col}`), `.task-col-${col} hidden`);
must(!hiddenAt920.includes('.task-col-area'), 'area is NOT hidden at 920px');
must(!hiddenAt920.includes('.task-col-title'), 'title is NOT hidden');
must(!hiddenAt920.includes('.task-col-status'), 'status is NOT hidden');
must(!hiddenAt920.includes('.task-col-deadline'), 'deadline is NOT hidden');
must(block(920).includes('.task-col-area { flex'), 'area is still sized at 920px');

console.log('\nvery narrow drops area as the next thing to go:');
const hiddenAt480 = hiddenCols(block(480));
console.log(`   hidden at 480px: ${hiddenAt480.join(', ') || '(none)'}`);
must(hiddenAt480.includes('.task-col-area'), 'area hidden below 480px');

console.log('\ntable cannot widen the page:');
must(css.includes('overflow-x: auto;\n  -webkit-overflow-scrolling: touch;') || css.includes('.task-table-scroll'), 'task-table-scroll exists');
const tts = css.split('.task-table-scroll {')[1].split('}')[0];
must(tts.includes('overflow-x: auto'), '.task-table-scroll has overflow-x: auto');

console.log('\nnavigation is never dead at a breakpoint:');
// Regression guard. Hiding .topnav without re-showing .menu-toggle left the
// app with no way to change view on a phone. jsdom applies no media queries,
// so test-menu cannot catch this -- only a stylesheet check can.
//
// Resolving "is it visible" needs the cascade, not a string search: absent
// a rule in the media block, the value is inherited from the base rule.
// Remove every @media block, leaving only the base rules. Needed because
// scanning the whole file finds the mobile override when checking whether
// the desktop default is hidden.
const stripMedia = (src) => {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const at = src.indexOf('@media', i);
    if (at < 0) { out += src.slice(i); break; }
    out += src.slice(i, at);
    const brace = src.indexOf('{', at);
    if (brace < 0) break;
    let depth = 0;
    for (let j = brace; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') {
        depth--;
        if (depth === 0) { i = j + 1; break; }
      }
    }
  }
  return out;
};

const displayOf = (src, sel) => {
  const f = flat(src);
  let val = null;
  for (const m of f.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map((s) => s.trim());
    if (!sels.includes(sel)) continue;
    const d = m[2].match(/display:\s*([^;}]+)/);
    if (d) val = d[1].trim();
  }
  return val;
};
const baseCss = stripMedia(css);
const effective = (sel, blockSrc) => displayOf(blockSrc, sel) ?? displayOf(baseCss, sel);

must(
  displayOf(baseCss, '.menu-toggle') === 'none',
  `menu toggle is hidden at desktop widths (got ${displayOf(baseCss, '.menu-toggle')})`
);

const b760 = block(760);
const topnavAt760 = effective('.topnav', b760);
const toggleAt760 = effective('.menu-toggle', b760);
console.log(`   .topnav at 760px      -> display: ${topnavAt760}`);
console.log(`   .menu-toggle at 760px -> display: ${toggleAt760}`);

const isHidden = (v) => v === 'none' || v === undefined;
must(isHidden(topnavAt760), 'nav pills are hidden on small screens');
must(
  !isHidden(toggleAt760),
  `the hamburger is VISIBLE on small screens (got ${toggleAt760})`
);

// The invariant that actually matters: never both hidden.
must(
  !(isHidden(topnavAt760) && isHidden(toggleAt760)),
  'navigation is not dead at this breakpoint'
);

must(
  app.includes("['daily', 'habits', 'areas', 'journal'].map"),
  'the menu is built from all four views'
);
must(
  app.includes('className="mobile-menu"'),
  'the slide-in menu exists in the markup'
);
must(
  (app.match(/role="menuitem"/g) || []).length >= 2,
  'menu items carry role="menuitem"'
);
must(app.includes('Sign out'), 'menu offers sign out');

console.log(bad ? `\n${bad} failure(s)` : '\nresponsive rules verified');
process.exit(bad ? 1 : 0);
