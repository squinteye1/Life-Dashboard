// LocalStorage-backed state with a clean Supabase swap-in seam.
// Each setter reads/writes one key. When wiring Supabase later, replace the
// body of these setters with API calls and mirror them into load().
//
// Storage keys (after the v2 reshape):
//   habits      — Habit[]                                  (flat list)
//   habitData   — { 'YYYY-MM-DD': { habitId: boolean } }   (per-day log)
//   taskData    — { areaId: Task[] }                       (per-area)
//   journalData — { 'YYYY-MM-DD': { mood, tags, text } }
//   dailyData   — { 'YYYY-MM-DD': { vibe, stress, energy, savedAt } }
//
// Task shape (current):
//   {
//     id: string,
//     title: string,
//     description: string,
//     status: 'todo' | 'in_progress' | 'done' | 'rejected',
//     areaId: string,           // FK into AREAS
//     createdAt: number,        // epoch ms
//     modifiedAt: number,       // epoch ms
//     completedAt: number|null, // epoch ms when status === 'done'
//     deadlineAt: number|null   // epoch ms (legacy: 'YYYY-MM-DD' string)
//   }
//
// Daily entry shape:
//   {
//     vibe:    number|null,   // Hawkins level (20-700)
//     stress:  number|null,   // 1-10
//     energy:  number|null,   // 1-10
//     savedAt: number         // epoch ms
//   }

const KEYS = {
  habits: 'habits',
  habitData: 'habitData',
  taskData: 'taskData',
  journalData: 'journalData',
  dailyData: 'dailyData'
};

export const STORAGE_KEYS = KEYS;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota / privacy mode — silently ignore
  }
}

function dropKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export const storage = {
  load: () => ({
    habits: read(KEYS.habits, null),
    habitData: read(KEYS.habitData, {}),
    taskData: read(KEYS.taskData, {}),
    journalData: read(KEYS.journalData, {}),
    dailyData: read(KEYS.dailyData, {})
  }),
  saveHabits: (v) => write(KEYS.habits, v),
  saveHabitData: (v) => write(KEYS.habitData, v),
  saveTaskData: (v) => write(KEYS.taskData, v),
  saveJournalData: (v) => write(KEYS.journalData, v),
  saveDailyData: (v) => write(KEYS.dailyData, v),
  dropKey
};

// Detect the old v1 per-area shape and clear it so v2 starts clean.
export function migrateFromV1() {
  // v1 used these keys with per-area nesting
  const v1Keys = ['kpis', 'kpiData'];
  v1Keys.forEach(dropKey);

  // v1 habits was { areaId: Habit[] } — drop if so.
  const oldHabitsRaw = (() => {
    try {
      return localStorage.getItem('habits');
    } catch {
      return null;
    }
  })();
  if (oldHabitsRaw) {
    try {
      const parsed = JSON.parse(oldHabitsRaw);
      const looksV1 =
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        Object.values(parsed).every(
          (v) => Array.isArray(v) && v.every((x) => x && x.id)
        );
      if (looksV1) dropKey('habits');
    } catch {
      // ignore
    }
  }

  // v1 habitData was { date: { areaId: { habitId: bool } } }
  const oldHabitLog = (() => {
    try {
      return localStorage.getItem('habitData');
    } catch {
      return null;
    }
  })();
  if (oldHabitLog) {
    try {
      const parsed = JSON.parse(oldHabitLog);
      const looksV1 =
        parsed &&
        typeof parsed === 'object' &&
        Object.values(parsed).some(
          (d) =>
            d &&
            typeof d === 'object' &&
            Object.values(d).some(
              (v) => v && typeof v === 'object' && !Array.isArray(v)
            )
        );
      if (looksV1) dropKey('habitData');
    } catch {
      // ignore
    }
  }
}

// Local-time ISO date key. yyyy-mm-dd.
export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

// yyyy-mm → "Jan 2026" short label.
export function monthLabel(year, monthIdx) {
  return new Date(year, monthIdx, 1).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric'
  });
}

// Monday=0 ... Sunday=6
export function weekdayIndex(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return (dt.getDay() + 6) % 7;
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
