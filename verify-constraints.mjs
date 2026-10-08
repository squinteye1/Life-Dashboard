// Temporary: check that every CHECK range in schema.sql can actually accept
// every value the app can produce. This bug class -- a constraint written
// from an assumed scale rather than the real data -- is invisible until a
// user hits it in the UI.
import { readFileSync } from 'node:fs';

const schema = readFileSync('supabase/schema.sql', 'utf8');
const areas = readFileSync('src/areas.js', 'utf8');
const weight = readFileSync('src/weight.js', 'utf8');

let bad = 0;
const must = (c, m) => {
  console.log(`  ${c ? 'OK  ' : 'FAIL'}  ${m}`);
  if (!c) bad++;
};

// Pull "col between lo and hi" out of the schema.
const ranges = {};
for (const m of schema.matchAll(
  /(\w+)\s+(?:integer|numeric\([^)]*\))\s+check\s*\(\s*\1\s+between\s+(-?\d+(?:\.\d+)?)\s+and\s+(-?\d+(?:\.\d+)?)\s*\)/g
)) {
  ranges[m[1]] = { lo: Number(m[2]), hi: Number(m[3]) };
}
console.log('CHECK ranges declared in schema.sql:');
for (const [c, r] of Object.entries(ranges))
  console.log(`  ${c.padEnd(10)} ${r.lo} .. ${r.hi}`);
console.log('');

// Every numeric value the app can actually send for that column.
const numbers = (src, re) => [...src.matchAll(re)].map((m) => Number(m[1]));
const samples = {
  vibe: numbers(areas, /value:\s*(\d+)/g),
  stress: numbers(readFileSync('src/App.jsx', 'utf8'), /\[1, 2, 3, 4, 5, 6, 7, 8, 9, 10\]/g)
    .flatMap(() => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
  energy: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
};
// Weight is validated in JS (MIN_KG/MAX_KG) and is numeric(6,2) with a range.
samples.kg = numbers(weight, /MIN_KG\s*=\s*(\d+)/g).concat(
  numbers(weight, /MAX_KG\s*=\s*(\d+)/g)
);

console.log('app value ranges vs the constraint:');
for (const [col, r] of Object.entries(ranges)) {
  const vals = samples[col];
  if (!vals || vals.length === 0) continue;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const fits = lo >= r.lo && hi <= r.hi;
  console.log(
    `  ${col.padEnd(10)} app ${lo}..${hi}   constraint ${r.lo}..${r.hi}`
  );
  must(fits, `${col}: every value the app can send fits the constraint`);
}

// The specific regression: Hawkins runs far past 100.
const hawkins = numbers(areas, /value:\s*(\d+)/g);
console.log('');
console.log(`  Hawkins levels: ${hawkins.length}, range ${Math.min(...hawkins)}..${Math.max(...hawkins)}`);
must(Math.max(...hawkins) <= (ranges.vibe?.hi ?? 0),
  'the highest Hawkins level is accepted by check_ins.vibe');
must(
  ranges.vibe && ranges.vibe.hi >= 1000,
  'the vibe constraint uses the full Hawkins scale (0-1000)'
);

console.log('');
console.log('migrations cover it:');
const migs = readFileSync('supabase/migrations/0002_fix_vibe_range.sql', 'utf8');
must(/between 0 and 1000/.test(migs), 'migration widens the range to 0-1000');
must(/drop constraint/i.test(migs), 'migration drops the old constraint');
must(/ilike '%vibe%'/.test(migs), 'migration finds the constraint by definition, not by name');

console.log(bad ? `\n${bad} failure(s)` : '\nschema constraints match the values the app sends');
process.exit(bad ? 1 : 0);