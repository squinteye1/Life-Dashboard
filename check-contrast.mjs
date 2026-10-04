// Temporary: read the real values back out of the built stylesheet and
// report WCAG contrast, so the numbers describe the file rather than my
// memory of what I intended to write.
import { readFileSync } from 'node:fs';

const css = readFileSync('src/styles.css', 'utf8');
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
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
};
const token = (n) => (css.match(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`)) || [])[1];

const surfaces = ['#080808', '#0d0d0d', '#121212'];
const names = ['bg', 'surface-1', 'surface-2'];
const worst = (c) => Math.min(...surfaces.map((s) => ratio(c, s)));

console.log('text contrast (AA needs 4.5:1), measured from src/styles.css:\n');
for (const t of ['text', 'text-dim', 'text-faint']) {
  const c = token(t);
  const w = worst(c);
  console.log(
    `  --${t.padEnd(11)} ${c}   worst ${w.toFixed(2)}:1   ${w >= 4.5 ? 'PASS' : 'FAIL'}`
  );
  names.forEach((n, i) =>
    process.stdout.write(`      vs ${n.padEnd(10)} ${ratio(c, surfaces[i]).toFixed(2)}\n`)
  );
}
console.log('\nborders (decorative; 3:1 is the bar for meaningful UI edges):');
for (const t of ['border', 'border-strong']) {
  const c = token(t);
  console.log(`  --${t.padEnd(14)} ${c}   vs bg ${ratio(c, '#080808').toFixed(2)}:1`);
}

const body = (css.match(/font-family: var\(--sans\);\s*\n\s*font-size: (\d+)px/) || [])[1];
const lbl = (css.match(/--fs-label:\s*(\d+)px/) || [])[1];
const meta = (css.match(/--fs-meta:\s*(\d+)px/) || [])[1];
console.log(`\ntype scale:\n  body ${body}px   --fs-label ${lbl}px (was 10)   --fs-meta ${meta}px (was 11)`);
console.log(`  rules using --fs-label: ${(css.match(/var\(--fs-label\)/g) || []).length}`);
console.log(`  rules using --fs-meta : ${(css.match(/var\(--fs-meta\)/g) || []).length}`);
console.log(`  rules left at hardcoded 10px: ${(css.match(/font-size: 10px/g) || []).length} (heatmap columns)`);

// Accent-coloured button text sits on a tint of the accent over the card
// surface, not on the bare surface. Composite it and check the real ratio,
// otherwise "it passes on --surface-2" hides a regression.
const mix = (fg, bg, pct) => {
  const a = hex(fg);
  const b = hex(bg);
  const p = pct / 100;
  return (
    '#' +
    a
      .map((v, i) =>
        Math.round(v * p + b[i] * (1 - p)).toString(16).padStart(2, '0')
      )
      .join('')
  );
};
console.log('\nvibrant action buttons (accent text on a tint of that accent):');
const acc = (n) => (css.match(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`)) || [])[1];
for (const [name, token, pct] of [
  ['checkin Edit', 'accent-daily', 14],
  ['journal Open', 'accent-journal', 16]
]) {
  const c = acc(token);
  const bg = mix(c, '#121212', pct); // --surface-2 under the tint
  const r = ratio(c, bg);
  console.log(
    `  ${name.padEnd(14)} ${c} on ${bg} (${pct}% tint)  ${r.toFixed(2)}:1  ${r >= 4.5 ? 'PASS AA' : 'FAIL'}`
  );
}
