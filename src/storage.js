// Pure date and id helpers.
//
// This file used to hold the whole localStorage persistence layer, plus a v1
// migration. Both are gone now that Supabase owns persistence — see
// src/api.js. Nothing here touches storage or the network, which is what
// makes it safe to call from render paths.

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function formatDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function monthLabel(year, monthIdx) {
  return new Date(year, monthIdx, 1).toLocaleDateString(undefined, {
    month: 'short'
  });
}

export function dateFromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function daysBetween(aKey, bKey) {
  const a = dateFromKey(aKey);
  const b = dateFromKey(bKey);
  return Math.round((b - a) / 86400000);
}

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}
