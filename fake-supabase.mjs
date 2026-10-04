// Temporary: a minimal in-memory stand-in for supabase-js.
//
// The important part is that it *simulates Row Level Security*:
//   - reads and deletes only ever see the signed-in user's rows
//   - writes carrying a different user_id are rejected, the way the
//     `with check` clause does
// So if api.js ever forgot to scope a query, this fake hides the row and the
// test fails, rather than the fake quietly papering over a security bug.

export function makeFakeClient(opts = {}) {
  const USER = opts.userId || 'user-1';
  const tables = {
    habits: [],
    habit_logs: [],
    check_ins: [],
    weights: [],
    journal_entries: [],
    tasks: [],
    settings: []
  };
  for (const [k, v] of Object.entries(opts.seed || {})) tables[k] = structuredClone(v);

  const state = { session: opts.signedIn === false ? null : { user: { id: USER } }, calls: [] };
  const listeners = [];

  const isRlsUser = (r) => r.user_id === USER;

  class Builder {
    constructor(table) {
      this.table = table;
      this.op = 'select';
      this.filters = [];
      this.payload = null;
      this.conflict = null;
      this.cols = null;
      this._order = null;
      this._limit = null;
      this._search = null;
    }
    // In supabase-js, .insert()/.upsert().select() is a *write* that returns
    // rows. Only apply a column projection when this is a read; blindly
    // setting op='select' here would turn every write into a no-op read.
    select(cols) {
      if (this.op === 'select') this.cols = cols;
      this._wantsRows = true;
      return this;
    }
    upsert(rows, o) { this.op = 'upsert'; this.payload = Array.isArray(rows) ? rows : [rows]; this.conflict = o?.onConflict; return this; }
    insert(rows) { this.op = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.filters.push(['eq', c, v]); return this; }
    gte(c, v) { this.filters.push(['gte', c, v]); return this; }
    lt(c, v) { this.filters.push(['lt', c, v]); return this; }
    order(c, o) { this._order = [c, o?.ascending !== false]; return this; }
    limit(n) { this._limit = n; return this; }
    textSearch(c, q) { this._search = [c, q]; return this; }
    then(onOk, onErr) { return this.exec().then(onOk, onErr); }

    _match(r) {
      for (const [op, c, v] of this.filters) {
        if (op === 'eq' && r[c] !== v) return false;
        if (op === 'gte' && !(r[c] >= v)) return false;
        if (op === 'lt' && !(r[c] < v)) return false;
      }
      return true;
    }

    async exec() {
      const name = this.table;
      state.calls.push({ table: name, op: this.op, filters: this.filters.slice() });
      // Test hook: make one table start failing, to prove the app surfaces
      // write failures rather than silently losing them.
      if (state.failTable === name) {
        return { data: null, error: { message: 'network down', code: '08006' } };
      }
      const rows = tables[name] || [];

      if (this.op === 'select') {
        // RLS: only the signed-in user's rows are visible.
        let out = rows.filter(isRlsUser).filter((r) => this._match(r));
        if (this._search) {
          const [col, q] = this._search;
          const needle = q.toLowerCase();
          out = out.filter((r) => String(r[col] || '').toLowerCase().includes(needle));
        }
        if (this._order) {
          const [c, asc] = this._order;
          out = [...out].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
        }
        if (this._limit != null) out = out.slice(0, this._limit);
        if (this.cols && this.cols !== '*') {
          const wanted = this.cols.split(',').map((s) => s.trim());
          out = out.map((r) => Object.fromEntries(wanted.filter((c) => c in r).map((c) => [c, r[c]])));
        }
        return { data: structuredClone(out), error: null };
      }

      if (this.op === 'delete') {
        const doomed = rows.filter(isRlsUser).filter((r) => this._match(r));
        for (const d of doomed) rows.splice(rows.indexOf(d), 1);
        return { data: structuredClone(doomed), error: null };
      }

      // insert / upsert — the `with check` clause.
      const incoming = this.payload || [];
      const keyCols = (this.conflict || '').split(',').map((s) => s.trim()).filter(Boolean);
      for (const row of incoming) {
        if (row.user_id !== USER) {
          // This is the RLS `with check` failure the schema prevents.
          return { data: null, error: { message: 'new row violates row-level security policy', code: '42501' } };
        }
      }
      if (this.op === 'insert') {
        for (const row of incoming) rows.push(structuredClone(row));
        return { data: structuredClone(incoming), error: null };
      }
      // upsert: merge on the conflict columns, or on user_id alone if none given.
      const keys = keyCols.length ? keyCols : ['user_id'];
      const merged = [];
      for (const row of incoming) {
        const key = keys.map((k) => String(row[k]));
        const existing = rows.find((r) => keys.every((k, i) => String(r[k]) === key[i]));
        if (existing) Object.assign(existing, structuredClone(row));
        else rows.push(structuredClone(row));
        merged.push(structuredClone(row));
      }
      return { data: structuredClone(merged), error: null };
    }
  }

  return {
    __state: state,
    __tables: tables,
    __USER: USER,
    __reset() { for (const k of Object.keys(tables)) tables[k] = []; },
    auth: {
      async getSession() {
        return state.session
          ? { data: { session: state.session }, error: null }
          : { data: { session: null }, error: null };
      },
      async signInWithPassword({ email }) {
        state.session = { user: { id: USER, email } };
        return { data: { user: state.session.user }, error: null };
      },
      async signOut() { state.session = null; return { error: null }; },
      onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: {} } }; }
    },
    from(name) {
      if (!tables[name]) return { select: () => ({ then: async () => ({ data: [], error: null }) }) };
      return new Builder(name);
    }
  };
}
