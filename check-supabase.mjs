// Temporary: verify the Supabase project is reachable, the schema is applied,
// and RLS actually blocks anonymous access. Reads .env.local without echoing
// any secret.
import { readFileSync } from 'node:fs';

const t = readFileSync('.env.local', 'utf8');
const get = (k) => {
  const m = t.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim() : null;
};
const url = get('VITE_SUPABASE_URL');
const key = get('VITE_SUPABASE_ANON_KEY');
if (!url || !key) { console.log('missing env vars'); process.exit(1); }

const H = { apikey: key, Authorization: 'Bearer ' + key };
let bad = 0;
const check = (c, m) => { console.log(`  ${c ? 'OK  ' : 'FAIL'}  ${m}`); if (!c) bad++; };

async function rest(path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: H, ...init });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

console.log(`project: ${url.replace(/https:\/\//, '').replace(/\.supabase\..*/, '')}\n`);

console.log('connectivity:');
const root = await fetch(`${url}/rest/v1/`, { headers: H });
check(root.status < 500, `REST endpoint reachable (${root.status})`);

console.log('\nschema applied (a missing table returns 404 / PGRST205):');
const tables = ['habits', 'habit_logs', 'check_ins', 'weights', 'journal_entries', 'tasks', 'settings'];
for (const tb of tables) {
  const r = await rest(`${tb}?select=*&limit=1`);
  const missing = r.status === 404 || (r.body && r.body.code === 'PGRST205');
  check(!missing, `${tb.padEnd(16)} ${missing ? 'MISSING' : 'present'}`);
}

console.log('\nRLS (must be an empty array, not rows and not an error):');
for (const tb of ['weights', 'check_ins', 'journal_entries']) {
  const r = await rest(`${tb}?select=*`);
  const isArray = Array.isArray(r.body);
  const empty = isArray && r.body.length === 0;
  check(empty, `${tb.padEnd(16)} ${empty ? '[] (locked down)' : JSON.stringify(r.body).slice(0, 120)}`);
}

console.log('\nanonymous write must be rejected:');
const w = await rest('weights', {
  method: 'POST',
  headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ user_id: '00000000-0000-0000-0000-000000000000', day: '2020-01-01', kg: '80' })
});
const rejected = w.status >= 400 || (Array.isArray(w.body) && w.body.length === 0);
check(rejected, `insert rejected (${w.status}${w.body && w.body.code ? ' ' + w.body.code : ''})`);

console.log('\nauth endpoint:');
const health = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key } });
check(health.ok, `auth health (${health.status})`);
const signIn = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'nobody@example.invalid', password: 'wrongwrongwrong' })
});
check(signIn.status === 400, `bad credentials rejected (${signIn.status})`);

console.log(bad ? `\n${bad} problem(s) - do not wire the app up yet` : '\nproject reachable, schema applied, RLS locked down');
process.exit(bad ? 1 : 0);
