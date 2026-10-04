// Temporary: confirm the per-view accent system is wired correctly.
// Uses plain string matching on purpose: regexes get mangled by shell
// escaping in this environment, which produced false failures before.
import { readFileSync } from 'node:fs';

const css = readFileSync('src/styles.css', 'utf8');
let bad = 0;
const must = (c, m) => {
  console.log(`  ${c ? 'OK  ' : 'FAIL'}  ${m}`);
  if (!c) bad++;
};

console.log('each view container redefines --accent:');
for (const [view, token] of [
  ['habits-view', '--accent-habits'],
  ['daily-view', '--accent-daily'],
  ['areas-view', '--accent-areas'],
  ['journal-view', '--accent-journal']
]) {
  const literal = `.${view} { --accent: var(${token}); }`;
  must(css.includes(literal), literal);
}

console.log('\neach accent token is defined:');
for (const t of ['--accent-habits', '--accent-daily', '--accent-areas', '--accent-journal']) {
  must(css.includes(`${t}: #`), `${t} has a hex value`);
}

console.log('\nheatmap ramp resolves against var(--accent):');
const heatCells = css.split('.heatmap-cell.lvl-').slice(1).map((s) => s.split('}')[0]);
must(heatCells.length === 5, `5 heatmap level rules, got ${heatCells.length}`);
const lv1to4 = heatCells.slice(1);
must(
  lv1to4.every((b) => b.includes('var(--accent)')),
  'lvl-1..4 all use var(--accent)'
);
must(!css.includes('126, 200, 163'), 'no hardcoded jade anywhere in the file');
const legend = css.split('.legend-cell.lvl-').slice(1).map((s) => s.split('}')[0]);
must(legend.length === 5, `5 legend level rules, got ${legend.length}`);
must(legend.slice(1).every((b) => b.includes('var(--accent)')), 'legend lvl-1..4 use var(--accent)');

console.log('\nevery accent clears WCAG AA as text on --bg:');
const hex = (h) => {
  h = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
};
const lin = (c) => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const lum = (r) => 0.2126 * lin(r[0]) + 0.7152 * lin(r[1]) + 0.0722 * lin(r[2]);
const ratio = (a, b) => {
  const l1 = lum(hex(a));
  const l2 = lum(hex(b));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
for (const m of css.matchAll(/--(accent-habits|accent-daily|accent-areas|accent-journal):\s*(#[0-9a-fA-F]{6})/g)) {
  const r = ratio(m[2], '#080808');
  must(r >= 4.5, `${m[1]} ${m[2]} = ${r.toFixed(2)}:1`);
}

console.log('\nbrand gradient defined and used on the header:');
must(css.includes('--brand-gradient: linear-gradient('), 'token defined');
must(css.includes('.header::after') && css.includes('var(--brand-gradient)'), 'header rule uses it');

console.log('\ntype scale:');
const body = (css.match(/font-family: var\(--sans\);\s*\n\s*font-size: (\d+)px/) || [])[1];
const label = (css.match(/--fs-label:\s*(\d+)px/) || [])[1];
const meta = (css.match(/--fs-meta:\s*(\d+)px/) || [])[1];
must(body === '17', `body is 17px (got ${body})`);
must(label === '12', `--fs-label is 12px (got ${label})`);
must(meta === '13', `--fs-meta is 13px (got ${meta})`);
must((css.match(/font-size: 10px/g) || []).length === 2, 'only the 2 heatmap column labels stay at 10px');

console.log(bad ? `\n${bad} failure(s)` : '\nper-view accent, type scale and brand rule verified');
process.exit(bad ? 1 : 0);
