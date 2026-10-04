import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AREAS,
  AREA_BY_ID,
  GLOBAL_HABITS,
  HABIT_ACCENT,
  HAWKINS_LEVELS,
  HAWKINS_BY_VALUE,
  HAWKINS_BANDS,
  MOODS,
  TASK_STATUS,
  TASK_STATUS_BY_ID
} from './areas.js';
import {
  todayKey,
  formatDate,
  monthLabel,
  dateFromKey,
  daysBetween,
  uid,
  pad2
} from './storage.js';
import { api, isConfigured } from './api.js';
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Scatter,
  Line
} from 'recharts';
import {
  kgToLb,
  lbToKg,
  kgToStonesLbs,
  stonesLbsToKg,
  isPlausibleKg,
  formatWeight,
  formatDelta,
  weightSeries,
  rollingMean,
  totalChange,
  weeklyRate,
  WEIGHT_UNITS,
  DEFAULT_WEIGHT_UNIT,
  MIN_KG,
  MAX_KG
} from './weight.js';

// ----------------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------------

function BootScreen() {
  return (
    <div className="boot-screen">
      <div className="boot-mark" aria-hidden="true">
        ◐
      </div>
      <div className="boot-text">Loading your dashboard…</div>
    </div>
  );
}

function SignInScreen({ onSignIn, error, configured }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setMsg('Enter your email and password.');
      return;
    }
    setBusy(true);
    setMsg(null);
    const err = await onSignIn(email.trim(), password);
    if (err) setMsg(err);
    setBusy(false);
  };

  if (!configured) {
    return (
      <div className="signin-screen">
        <div className="signin-card">
          <div className="signin-mark" aria-hidden="true">
            ◐
          </div>
          <h1 className="signin-title">Not configured</h1>
          <p className="signin-sub">
            Add these to <code>.env.local</code> in the project root, then
            restart the dev server:
          </p>
          <pre className="signin-code">
            VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co{'\n'}
            VITE_SUPABASE_ANON_KEY=your-anon-key
          </pre>
          <p className="signin-note">
            Only the <strong>anon public</strong> key belongs here. Never the
            service role key.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="signin-screen">
      <form className="signin-card" onSubmit={submit}>
        <div className="signin-mark" aria-hidden="true">
          ◐
        </div>
        <h1 className="signin-title">LIFE.DASHBOARD</h1>
        <p className="signin-sub">Sign in to load your data.</p>

        <label className="signin-field">
          <span className="signin-label">email</span>
          <input
            type="email"
            className="signin-input"
            value={email}
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </label>

        <label className="signin-field">
          <span className="signin-label">password</span>
          <input
            type="password"
            className="signin-input"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {msg && (
          <div className="signin-error" role="alert">
            {msg}
          </div>
        )}

        <button
          type="submit"
          className="signin-submit"
          disabled={busy}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState('daily');
  const [activeAreaId, setActiveAreaId] = useState(AREAS[0].id);
  const [viewingDate, setViewingDate] = useState(todayKey());

  const [habits, setHabits] = useState([]);
  const [habitData, setHabitData] = useState({});
  const [taskData, setTaskData] = useState({});
  const [journalData, setJournalData] = useState({});
  const [dailyData, setDailyData] = useState({});
  const [weightData, setWeightData] = useState({});
  const [settings, setSettings] = useState({ weightUnit: DEFAULT_WEIGHT_UNIT });

  // Three real states, not a boolean. Rendering the loaded UI while still
  // fetching looks exactly like your entire history being deleted, so the
  // loading state gets its own screen.
  const [authState, setAuthState] = useState('checking'); // checking|signedOut|ready
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);

  // Write failures must be visible. localStorage always succeeded, so it is
  // easy to forget that a network write can silently not happen.
  const onApiError = useCallback((what, err) => {
    setSaveError(`${what}: ${err?.message || err}`);
  }, []);

  const db = useMemo(
    () => api({ onError: onApiError }),
    [onApiError]
  );

  const loadAll = useCallback(async () => {
    const res = await db.hydrate();
    if (!res.ok) {
      setLoadError(res.error?.message || 'Could not load your data.');
      setAuthState('signedOut');
      return;
    }
    const d = res.data;
    const nextHabits = d.habits.length
      ? d.habits
      : GLOBAL_HABITS.map((h) => ({ ...h }));
    setHabits(nextHabits);
    setHabitData(d.habitData);
    setTaskData(d.taskData);
    setJournalData(d.journalData);
    setDailyData(d.dailyData);
    setWeightData(d.weightData);
    setSettings(d.settings);
    // First run: seed the default habits. Idempotent, so safe on every boot.
    if (!d.habits.length) await db.saveHabits(nextHabits);
    setLoadError(null);
    setAuthState('ready');
  }, [db]);

  // Resolve the session, then load. Re-runs when the session changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await db.getSession();
      if (cancelled) return;
      if (!res.ok || !res.data) {
        setAuthState('signedOut');
        return;
      }
      await loadAll();
    })();
    return () => {
      cancelled = true;
    };
  }, [db, loadAll]);

  const handleSignIn = async (email, password) => {
    setLoadError(null);
    const res = await db.signIn(email, password);
    if (!res.ok) return res.error?.message || 'Could not sign in.';
    await loadAll();
    return null;
  };

  const handleSignOut = async () => {
    await db.signOut();
    setHabits([]);
    setHabitData({});
    setTaskData({});
    setJournalData({});
    setDailyData({});
    setWeightData({});
    setAuthState('signedOut');
  };

  // Every mutation below is an explicit call. There are deliberately no
  // "save the whole state" effects: a network write on every state change
  // means a request per keystroke in the journal textarea.

  const setWeightUnit = (weightUnit) => {
    setSettings((prev) => ({ ...prev, weightUnit }));
    db.saveSettings({ weightUnit });
  };

  // Each of these updates local state *and* fires exactly one network write.
  // Local state stays the source of truth for rendering, so the UI does not
  // wait on the network, and a slow connection never blocks typing.

  const saveHabitDone = useCallback(
    (habitId, day, done) => {
      setHabitData((prev) => {
        const forDay = { ...(prev[day] || {}) };
        if (done) forDay[habitId] = true;
        else delete forDay[habitId];
        const next = { ...prev };
        if (Object.keys(forDay).length === 0) delete next[day];
        else next[day] = forDay;
        return next;
      });
      db.setHabitDone(habitId, day, done);
    },
    [db]
  );

  const saveJournalEntry = useCallback(
    (day, entry) => {
      setJournalData((prev) => ({ ...prev, [day]: entry }));
      db.upsertJournalEntry(day, entry);
    },
    [db]
  );

  const saveCheckIn = useCallback(
    (day, entry) => {
      setDailyData((prev) => ({ ...prev, [day]: entry }));
      db.upsertCheckIn(day, entry);
    },
    [db]
  );

  const clearCheckIn = useCallback(
    (day) => {
      setDailyData((prev) => {
        const next = { ...prev };
        delete next[day];
        return next;
      });
      db.clearCheckIn(day);
    },
    [db]
  );

  const saveWeight = useCallback(
    (day, kg) => {
      setWeightData((prev) => ({ ...prev, [day]: { kg, savedAt: Date.now() } }));
      db.upsertWeight(day, kg);
    },
    [db]
  );

  const clearWeight = useCallback(
    (day) => {
      setWeightData((prev) => {
        const next = { ...prev };
        delete next[day];
        return next;
      });
      db.clearWeight(day);
    },
    [db]
  );

  const saveTask = useCallback(
    (task) => {
      setTaskData((prev) => {
        const list = prev[task.areaId] || [];
        const exists = list.some((t) => t.id === task.id);
        return {
          ...prev,
          [task.areaId]: exists
            ? list.map((t) => (t.id === task.id ? task : t))
            : [...list, task]
        };
      });
      db.createTask(task);
    },
    [db]
  );

  const deleteTask = useCallback(
    (id) => {
      setTaskData((prev) => {
        const next = {};
        for (const [areaId, list] of Object.entries(prev)) {
          next[areaId] = list.filter((t) => t.id !== id);
        }
        return next;
      });
      db.deleteTask(id);
    },
    [db]
  );

  const today = todayKey();

  // Clamp viewing date — never let it slip into the future.
  const safeViewingDate =
    viewingDate > today ? today : viewingDate;

  if (authState === 'checking') {
    return (
      <div className="app">
        <main className="main">
          <BootScreen />
        </main>
      </div>
    );
  }

  if (authState === 'signedOut') {
    return (
      <div className="app">
        <main className="main">
          <SignInScreen
            onSignIn={handleSignIn}
            error={loadError}
            configured={isConfigured}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        view={view}
        setView={setView}
        viewingDate={safeViewingDate}
        setViewingDate={setViewingDate}
        today={today}
        onSignOut={handleSignOut}
      />
      {saveError && (
        <div className="save-error-banner" role="alert">
          <span className="save-error-text">{saveError}</span>
          <button
            type="button"
            className="save-error-dismiss"
            onClick={() => setSaveError(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      <main className="main">
        {view === 'habits' && (
          <HabitsView
            habits={habits}
            habitData={habitData}
            today={today}
            viewingDate={safeViewingDate}
            setViewingDate={setViewingDate}
            onToggleHabit={saveHabitDone}
          />
        )}
        {view === 'areas' && (
          <AreasView
            activeAreaId={activeAreaId}
            setActiveAreaId={setActiveAreaId}
            taskData={taskData}
            setTaskData={setTaskData}
            onTaskSave={saveTask}
            onTaskDelete={deleteTask}
          />
        )}
        {view === 'journal' && (
          <JournalView
            journalData={journalData}
            onSaveEntry={saveJournalEntry}
            viewingDate={safeViewingDate}
            setViewingDate={setViewingDate}
            today={today}
          />
        )}
        {view === 'daily' && (
          <DailyView
            dailyData={dailyData}
            taskData={taskData}
            habitData={habitData}
            habits={habits}
            journalData={journalData}
            viewingDate={safeViewingDate}
            setViewingDate={setViewingDate}
            today={today}
            onOpenTask={(task) => {
              if (task && task.areaId) setActiveAreaId(task.areaId);
              setView('areas');
            }}
            onOpenJournal={() => setView('journal')}
            onOpenHabits={() => setView('habits')}
            onSaveCheckIn={saveCheckIn}
            onClearCheckIn={clearCheckIn}
            onSaveWeight={saveWeight}
            onClearWeight={clearWeight}
            weightData={weightData}
            weightUnit={settings.weightUnit}
            setWeightUnit={setWeightUnit}
          />
        )}
      </main>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Header
// ----------------------------------------------------------------------------

function Header({
  view,
  setView,
  viewingDate,
  setViewingDate,
  today,
  onSignOut
}) {
  const isToday = viewingDate === today;
  const dateInputRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // With the graphs hidden on small screens, this date picker is the only
  // way to reach another day, so the menu must not swallow it.
  const openDatePicker = () => {
    const el = dateInputRef.current;
    if (!el) return;
    try {
      if (typeof el.showPicker === 'function') {
        el.showPicker();
      } else {
        el.focus();
        el.click();
      }
    } catch {
      el.focus();
    }
  };

  const go = (next) => {
    setView(next);
    setMenuOpen(false);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // The menu is rendered as a *sibling* of the header, not inside it.
  // The header has backdrop-filter, which makes it the containing block for
  // position:fixed descendants — a full-height panel nested inside it gets
  // clipped to the header's box and lands in the wrong place entirely.
  return (
    <>
    <header className="header">
      <div className="header-top">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ◐
          </span>
          <span className="brand-name">LIFE.DASHBOARD</span>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="menu-toggle"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            <span aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
          </button>
          <button
            type="button"
            className="today-btn signout-btn"
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
          >
            <span className="signout-icon" aria-hidden="true">
              ⏻
            </span>
          </button>
        </div>
      </div>
      {/* Nav and date sit in one wrapper so they can stack on desktop and
          share a single line on a phone. */}
      <div className="header-nav-row">
      <nav className="topnav" aria-label="Primary">
        <button
          type="button"
          className={`nav-pill ${view === 'daily' ? 'is-active' : ''}`}
          onClick={() => setView('daily')}
        >
          Daily
        </button>
        <button
          type="button"
          className={`nav-pill ${view === 'habits' ? 'is-active' : ''}`}
          onClick={() => setView('habits')}
        >
          Habits
        </button>
        <button
          type="button"
          className={`nav-pill ${view === 'areas' ? 'is-active' : ''}`}
          onClick={() => setView('areas')}
        >
          Areas
        </button>
        <button
          type="button"
          className={`nav-pill ${view === 'journal' ? 'is-active' : ''}`}
          onClick={() => setView('journal')}
        >
          Journal
        </button>
      </nav>
      <div className="header-date">
        <div
          className={`date-chip ${isToday ? '' : 'is-past'}`}
          role="button"
          tabIndex={0}
          onClick={openDatePicker}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openDatePicker();
            }
          }}
          title="Jump to date"
        >
          <span className="date-chip-icon" aria-hidden="true">
            ⌗
          </span>
          <span className="date-chip-display">
            <span className="date-chip-eyebrow">
              {isToday ? 'today' : 'viewing'}
            </span>
            <span className="date-chip-value">{formatShortDate(viewingDate)}</span>
            <span className="date-chip-chevron" aria-hidden="true">
              ▾
            </span>
          </span>
          <input
            ref={dateInputRef}
            type="date"
            className="date-chip-input"
            value={viewingDate}
            max={today}
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const next = e.target.value;
              if (!next) return;
              setViewingDate(next > today ? today : next);
            }}
          />
        </div>
        {!isToday && (
          <button
            type="button"
            className="today-btn"
            onClick={() => setViewingDate(today)}
          >
            ← Today
          </button>
        )}
      </div>
      </div>
    </header>
    {menuOpen && (
      <>
        <div
          className="menu-backdrop"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
        <div className="mobile-menu" id="mobile-menu" role="menu">
          {['daily', 'habits', 'areas', 'journal'].map((v) => (
            <button
              key={v}
              type="button"
              role="menuitem"
              className={`mobile-menu-item ${view === v ? 'is-active' : ''}`}
              style={{ '--menu-accent': `var(--accent-${v})` }}
              onClick={() => go(v)}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
          <div className="mobile-menu-divider" />
          {!isToday && (
            <button
              type="button"
              role="menuitem"
              className="mobile-menu-item"
              onClick={() => {
                setViewingDate(today);
                setMenuOpen(false);
              }}
            >
              ← Today
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="mobile-menu-item is-danger"
            onClick={() => {
              setMenuOpen(false);
              onSignOut();
            }}
          >
            <span className="signout-icon" aria-hidden="true">
              ⏻
            </span>
            Sign out
          </button>
        </div>
      </>
    )}
    </>
  );
}

function formatShortDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

// ----------------------------------------------------------------------------
// Habits view — year heatmap + today's toggles + per-habit streaks
// ----------------------------------------------------------------------------

function HabitsView({
  habits,
  habitData,
  today,
  viewingDate,
  setViewingDate,
  onToggleHabit
}) {
  const currentYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(currentYear);

  // Build the heatmap grid once per year.
  const grid = useMemo(() => buildYearGrid(year), [year]);

  // Per-habit streak (always anchored to today).
  const streaks = useMemo(() => {
    const out = {};
    for (const h of habits) {
      out[h.id] = computeStreak(habitData, h.id, today);
    }
    return out;
  }, [habits, habitData, today]);

  // Year-to-date totals.
  const yearStats = useMemo(
    () => computeYearStats(habitData, grid, habits.length, today),
    [habitData, grid, habits.length, today]
  );

  const toggleHabit = (habitId, dateKey) => {
    if (dateKey > today) return; // future
    onToggleHabit(habitId, dateKey, !habitData[dateKey]?.[habitId]);
  };

  const jumpToDay = (dateKey) => {
    if (dateKey > today) return;
    setViewingDate(dateKey);
    // Nudge the heatmap to the year we just selected, if needed.
    setYear(Number(dateKey.slice(0, 4)));
  };

  const isViewingToday = viewingDate === today;

  return (
    <section className="habits-view">
      <div className="year-header">
        <div>
          <div className="year-eyebrow">Year in pixels</div>
          <h1 className="year-title">{year}</h1>
        </div>
        <div className="year-nav">
          <button
            type="button"
            className="year-nav-btn"
            onClick={() => setYear((y) => y - 1)}
            aria-label="Previous year"
          >
            ←
          </button>
          {year !== currentYear && (
            <button
              type="button"
              className="year-today-btn"
              onClick={() => setYear(currentYear)}
            >
              Today
            </button>
          )}
          <button
            type="button"
            className="year-nav-btn"
            onClick={() => setYear((y) => Math.min(currentYear, y + 1))}
            disabled={year >= currentYear}
            aria-label="Next year"
          >
            →
          </button>
        </div>
      </div>

      <YearHeatmap
        grid={grid}
        today={today}
        year={year}
        levelFor={(k) =>
          levelFromCount(countCompleted(habitData[k]), habits.length)
        }
        tipFor={(k) => [
          `${countCompleted(habitData[k])} / ${habits.length} completed`
        ]}
        onSelect={jumpToDay}
        legendHint="· click any day to open it"
      />

      <YearStats stats={yearStats} year={year} />

      <section className="habit-list-section">
        <header className="section-header">
          <div>
            <h2 className="section-title">
              {isViewingToday ? "Today's Habits" : 'On ' + formatShortDate(viewingDate)}
            </h2>
            {!isViewingToday && (
              <div className="section-sub">
                Viewing a past day — backfill any missed habits.
              </div>
            )}
          </div>
          <span className="section-meta">
            {formatDate(viewingDate)}
          </span>
        </header>
        <div className="habit-list">
          {habits.map((h) => (
            <HabitRow
              key={h.id}
              habit={h}
              dateKey={viewingDate}
              checked={!!habitData[viewingDate]?.[h.id]}
              streak={streaks[h.id] || 0}
              onToggle={() => toggleHabit(h.id, viewingDate)}
            />
          ))}
        </div>
      </section>
    </section>
  );
}

// Build a 53-week × 7-day grid for the given year. Days outside `year`
// are still cells, just flagged as future-or-previous so we can dim them.
function buildYearGrid(year) {
  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);
  // Snap start back to the most recent Monday (or Jan 1 if it is Monday).
  const startOffset = (jan1.getDay() + 6) % 7;
  const start = new Date(jan1);
  start.setDate(start.getDate() - startOffset);
  // 53 columns gives a comfortable margin for any year.
  const cols = 53;
  const cells = new Array(cols * 7);
  for (let w = 0; w < cols; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      const ymd = `${date.getFullYear()}-${pad2(
        date.getMonth() + 1
      )}-${pad2(date.getDate())}`;
      cells[w * 7 + d] = {
        key: ymd,
        year: date.getFullYear(),
        month: date.getMonth(),
        day: date.getDate(),
        week: w,
        weekday: d,
        inYear: date.getFullYear() === year
      };
    }
  }
  return { cells, cols, year, firstDate: start, lastDate: dec31 };
}

// Count consecutive days ending at (or before) `todayKey` where habitId is true.
// If today isn't done, the streak still ends on the most recent run.
function computeStreak(habitData, habitId, todayKeyStr) {
  const today = dateFromKey(todayKeyStr);
  let streak = 0;
  const cur = new Date(today);
  // First, decide the anchor: most recent day with the habit done.
  let anchor = null;
  for (let i = 0; i < 366; i++) {
    const k = todayKey(cur);
    if (habitData[k]?.[habitId]) {
      anchor = new Date(cur);
      break;
    }
    cur.setDate(cur.getDate() - 1);
  }
  if (!anchor) return 0;
  // Walk backwards from anchor counting true days.
  const walk = new Date(anchor);
  for (let i = 0; i < 366; i++) {
    const k = todayKey(walk);
    if (habitData[k]?.[habitId]) {
      streak++;
      walk.setDate(walk.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function computeYearStats(habitData, grid, habitTotal, todayKeyStr) {
  const today = dateFromKey(todayKeyStr);
  const year = grid.year;
  // Walk day by day this year, and through full year if viewing past.
  const end = grid.year === today.getFullYear() ? today : new Date(year, 11, 31);
  const start = new Date(year, 0, 1);
  let days = 0;
  let completions = 0;
  let perfectDays = 0;
  let bestStreak = 0;
  let currentStreak = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const k = todayKey(cur);
    const day = habitData[k] || {};
    const done = Object.values(day).filter(Boolean).length;
    days++;
    completions += done;
    if (done >= habitTotal) perfectDays++;
    if (done > 0) {
      currentStreak++;
      if (currentStreak > bestStreak) bestStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
    cur.setDate(cur.getDate() + 1);
  }
  const denom = habitTotal * days;
  const pct = denom > 0 ? Math.round((completions / denom) * 100) : 0;
  return { days, completions, perfectDays, bestStreak, pct };
}

// ----------------------------------------------------------------------------
// Year heatmap
// ----------------------------------------------------------------------------

// One GitHub-style year grid, reused by Habits and Daily Check-ins.
// `levelFor(key)` returns 0-4 (0 = no data). `tipFor(key)` returns the
// tooltip lines, which also become the cell's aria-label.
function YearHeatmap({ grid, today, year, levelFor, tipFor, onSelect, legendHint, tipClassName }) {
  const [hovered, setHovered] = useState(null); // { key, x, y }

  // Month label per column = first in-year cell whose month starts in that col.
  const monthCols = useMemo(() => {
    const seen = new Set();
    const out = new Array(grid.cols).fill(null);
    grid.cells.forEach((c) => {
      if (!c.inYear) return;
      if (c.weekday === 0 && !seen.has(c.month)) {
        seen.add(c.month);
        out[c.week] = c.month;
      }
    });
    return out;
  }, [grid]);

  const todayCellIdx = grid.cells.findIndex((c) => c.key === today);

  return (
    <div className="heatmap-wrap">
      <div className="heatmap">
        <div className="heatmap-months">
          {monthCols.map((m, i) => (
            <div key={i} className="heatmap-month-cell">
              {m != null ? monthLabel(year, m).split(' ')[0] : ''}
            </div>
          ))}
        </div>
        <div className="heatmap-body">
          <div className="heatmap-days">
            {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((d, i) => (
              <div key={i} className="heatmap-day-label">
                {d}
              </div>
            ))}
          </div>
          <div
            className="heatmap-grid"
            style={{ gridTemplateColumns: `repeat(${grid.cols}, var(--cell))` }}
          >
            {grid.cells.map((c, i) => {
              const level = levelFor(c.key);
              const lines = tipFor(c.key);
              const isToday = i === todayCellIdx;
              const isFuture = c.key > today;
              const className = [
                'heatmap-cell',
                `lvl-${level}`,
                isToday ? 'is-today' : '',
                !c.inYear ? 'is-out' : '',
                isFuture ? 'is-future' : ''
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={i}
                  type="button"
                  className={className}
                  disabled={isFuture || !c.inYear}
                  aria-label={
                    lines.length ? `${c.key} · ${lines.join(' · ')}` : c.key
                  }
                  onMouseEnter={(e) =>
                    setHovered({
                      key: c.key,
                      x: e.clientX,
                      y: e.clientY
                    })
                  }
                  onMouseMove={(e) =>
                    setHovered((h) =>
                      h ? { ...h, x: e.clientX, y: e.clientY } : h
                    )
                  }
                  onMouseLeave={() => setHovered(null)}
                  onFocus={(e) =>
                    setHovered({
                      key: c.key,
                      x: e.currentTarget.getBoundingClientRect().left,
                      y: e.currentTarget.getBoundingClientRect().top
                    })
                  }
                  onBlur={() => setHovered(null)}
                  onClick={() => {
                    // Toggling habits happens in the list below; here a
                    // click only navigates to that day.
                    if (onSelect) onSelect(c.key);
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="heatmap-legend" aria-hidden="true">
        <span className="legend-label">less</span>
        {[0, 1, 2, 3, 4].map((lvl) => (
          <span key={lvl} className={`legend-cell lvl-${lvl}`} />
        ))}
        <span className="legend-label">more</span>
        {legendHint && <span className="legend-hint">{legendHint}</span>}
      </div>

      {hovered && (
        <div
          className={tipClassName ? `heatmap-tip ${tipClassName}` : 'heatmap-tip'}
          style={{
            left: hovered.x,
            top: hovered.y
          }}
          role="tooltip"
        >
          <div className="tip-date">{formatDate(hovered.key)}</div>
          {tipFor(hovered.key).map((line) => (
            <div key={line} className="tip-count">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function countCompleted(dayRecord) {
  if (!dayRecord) return 0;
  return Object.values(dayRecord).filter(Boolean).length;
}

function levelFromCount(count, total) {
  if (count === 0 || total === 0) return 0;
  const ratio = count / total;
  if (ratio <= 0.2) return 1;
  if (ratio <= 0.4) return 2;
  if (ratio <= 0.7) return 3;
  return 4;
}

// Vibe is an absolute 0-100 score, not a ratio, so it gets its own bands.
// Darker always means better, matching the habits ramp.
function levelFromVibe(vibe) {
  if (vibe == null) return 0;
  if (vibe <= 25) return 1;
  if (vibe <= 50) return 2;
  if (vibe <= 75) return 3;
  return 4;
}

// A day counts as "written" if it has any text or a mood. Days you never
// wrote on and days you skipped look identical on the graph — deliberately,
// since there is nothing useful to distinguish between them.
function hasJournalEntry(journalData, key) {
  const e = journalData[key];
  if (!e) return false;
  return !!(e.text || '').trim() || !!e.mood;
}

// Journal presence is binary: every written day gets the same level, so the
// grid shows that you showed up without ranking one day above another.
const JOURNAL_PRESENT_LEVEL = 3;

function journalLevel(journalData, key) {
  return hasJournalEntry(journalData, key) ? JOURNAL_PRESENT_LEVEL : 0;
}

const JOURNAL_PREVIEW_CHARS = 90;

// Tooltip lines for a day. Also the cell's aria-label.
function journalTipLines(journalData, key) {
  const e = journalData[key];
  if (!hasJournalEntry(journalData, key)) return ['No entry'];
  const out = [];
  if (e.mood) {
    const m = MOODS.find((x) => x.id === e.mood);
    if (m) out.push(`${m.emoji} ${m.label}`);
  }
  if (e.tags && e.tags.length > 0) {
    const names = e.tags.map((id) => AREA_BY_ID[id]?.name).filter(Boolean);
    if (names.length > 0) out.push(names.join(' · '));
  }
  const body = (e.text || '').replace(/\s+/g, ' ').trim();
  if (body) {
    out.push(
      body.length > JOURNAL_PREVIEW_CHARS
        ? `"${body.slice(0, JOURNAL_PREVIEW_CHARS).trimEnd()}…"`
        : `"${body}"`
    );
  }
  return out.length > 0 ? out : ['No text'];
}

// ----------------------------------------------------------------------------
// Year stats
// ----------------------------------------------------------------------------

function YearStats({ stats, year }) {
  return (
    <div className="year-stats">
      <Stat label="Completions" value={stats.completions.toLocaleString()} />
      <Stat label="Days tracked" value={stats.days.toLocaleString()} />
      <Stat
        label={`Perfect days`}
        value={stats.perfectDays.toLocaleString()}
      />
      <Stat label="Best streak" value={`${stats.bestStreak}d`} />
      <Stat label="Average" value={`${stats.pct}%`} />
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Today's habits list — full-width clickable cards
// ----------------------------------------------------------------------------

function HabitRow({ habit, checked, onToggle, streak }) {
  return (
    <button
      type="button"
      className={`habit-card ${checked ? 'is-checked' : ''}`}
      onClick={onToggle}
      aria-pressed={checked}
    >
      <span className="habit-card-check" aria-hidden="true">
        <span className="habit-card-check-mark">✓</span>
      </span>
      <span className="habit-card-info">
        <span className="habit-card-name">{habit.name}</span>
        <span className="habit-card-note">{habit.note}</span>
      </span>
      <span className="habit-card-meta" title="Current streak">
        <span className="habit-card-streak-value">{streak}</span>
        <span className="habit-card-streak-suffix">d</span>
      </span>
    </button>
  );
}

// ----------------------------------------------------------------------------
// Areas view — task panel per area
// ----------------------------------------------------------------------------

function AreasView({
  activeAreaId,
  setActiveAreaId,
  taskData,
  setTaskData,
  onTaskSave,
  onTaskDelete
}) {
  const isAll = activeAreaId === 'all';
  const [drawerState, setDrawerState] = useState(null);

  const openCreate = () => setDrawerState({ mode: 'create' });
  const openEdit = (taskId) => setDrawerState({ mode: 'edit', taskId });
  const closeDrawer = () => setDrawerState(null);

  // Flatten tasks for the panel, ensuring each task carries its areaId.
  const aggregatedTasks = useMemo(() => {
    const out = [];
    for (const a of AREAS) {
      for (const t of taskData[a.id] || []) {
        out.push(t.areaId ? t : { ...t, areaId: a.id });
      }
    }
    return out;
  }, [taskData]);

  // setTasks works on the aggregated list and splits the result back into
  // taskData by areaId. Local state only — each caller is responsible for
  // persisting, so there is exactly one network write per user action.
  const setTasks = (updater) => {
    setTaskData((prev) => {
      const current = [];
      for (const a of AREAS) {
        for (const t of prev[a.id] || []) {
          current.push(t.areaId ? t : { ...t, areaId: a.id });
        }
      }
      const next = typeof updater === 'function' ? updater(current) : updater;
      const split = {};
      for (const a of AREAS) split[a.id] = [];
      for (const t of next) {
        const aid = t.areaId;
        if (aid && split[aid]) split[aid].push(t);
      }
      return split;
    });
  };

  const defaultNewTaskAreaId = isAll ? AREAS[0].id : activeAreaId;
  const headerArea = isAll ? null : AREA_BY_ID[activeAreaId];
  const headerColor = isAll ? '#ffffff' : headerArea.color;
  const visibleTasks = isAll
    ? aggregatedTasks
    : aggregatedTasks.filter((t) => t.areaId === activeAreaId);
  const openCount = visibleTasks.filter(
    (t) => t.status === 'todo' || t.status === 'in_progress'
  ).length;
  const totalOpen = AREAS.reduce(
    (sum, a) =>
      sum +
      (taskData[a.id] || []).filter(
        (t) => t.status === 'todo' || t.status === 'in_progress'
      ).length,
    0
  );

  return (
    <section className="areas-view">
      <header className="section-header areas-header">
        <div>
          <div className="section-eyebrow">By area</div>
          <h1 className="section-title-lg">Tasks</h1>
        </div>
      </header>

      <div className="area-selector">
        <div className="area-selector-track">
          <button
            type="button"
            className={`area-card ${isAll ? 'is-active' : ''}`}
            style={{ '--accent': '#cfcfcf' }}
            onClick={() => setActiveAreaId('all')}
          >
            <span className="area-card-dot" />
            <span className="area-card-name">All</span>
            <span className="area-card-meta">
              {totalOpen > 0 ? totalOpen : '·'}
            </span>
          </button>
          {AREAS.map((a) => {
            const open = (taskData[a.id] || []).filter(
              (t) => t.status === 'todo' || t.status === 'in_progress'
            ).length;
            const isActive = a.id === activeAreaId;
            return (
              <button
                key={a.id}
                type="button"
                className={`area-card ${isActive ? 'is-active' : ''}`}
                style={{ '--accent': a.color }}
                onClick={() => setActiveAreaId(a.id)}
              >
                <span className="area-card-dot" />
                <span className="area-card-name">{a.name}</span>
                <span className="area-card-meta">{open > 0 ? open : '·'}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="area-panel" key={activeAreaId}>
        <div className="area-header" style={{ '--accent': headerColor }}>
          <div>
            <div className="area-eyebrow">
              {isAll ? 'all areas' : 'area'}
            </div>
            <h2 className="area-name">
              {isAll ? 'All Areas' : headerArea.name}
            </h2>
            <div className="area-blurb">
              {isAll
                ? 'Tasks across every life area.'
                : headerArea.blurb}
            </div>
          </div>
          <div className="area-count">{openCount} open</div>
        </div>

        <TaskPanel
          isAll={isAll}
          defaultNewTaskAreaId={defaultNewTaskAreaId}
          tasks={visibleTasks}
          setTasks={setTasks}
          onTaskPersist={onTaskSave}
          onTaskDelete={onTaskDelete}
          onCreate={openCreate}
          onEdit={openEdit}
        />
      </div>

      <TaskDrawer
        open={drawerState !== null}
        mode={drawerState?.mode}
        task={
          drawerState?.mode === 'edit' && drawerState.taskId
            ? aggregatedTasks.find((t) => t.id === drawerState.taskId)
            : null
        }
        initialAreaId={defaultNewTaskAreaId}
        isAll={isAll}
        onClose={closeDrawer}
        onSave={(task) => {
          if (drawerState?.mode === 'create') {
            setTasks((prev) => [...prev, task]);
          } else {
            setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
          }
          onTaskSave(task);
        }}
        onDelete={(id) => {
          setTasks((prev) => prev.filter((t) => t.id !== id));
          onTaskDelete(id);
        }}
      />
    </section>
  );
}

function TaskPanel({
  isAll,
  defaultNewTaskAreaId,
  tasks,
  setTasks,
  onTaskPersist,
  onTaskDelete,
  onCreate,
  onEdit
}) {
  const newArea = AREA_BY_ID[defaultNewTaskAreaId] || AREAS[0];

  // A status change is a real edit, so it goes to the database too.
  const setStatus = (id, newStatus) => {
    const now = Date.now();
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const completedAt =
          newStatus === 'done' ? t.completedAt || now : null;
        return { ...t, status: newStatus, completedAt, modifiedAt: now };
      })
    );
    const current = tasks.find((t) => t.id === id);
    if (current) {
      onTaskPersist({
        ...current,
        status: newStatus,
        completedAt: newStatus === 'done' ? current.completedAt || now : null,
        modifiedAt: now
      });
    }
  };

  const deleteTask = (id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    onTaskDelete(id);
  };

  const active = tasks.filter(
    (t) => t.status === 'todo' || t.status === 'in_progress'
  );
  const completed = tasks.filter((t) => t.status === 'done');
  const rejected = tasks.filter((t) => t.status === 'rejected');

  // Active: in-progress first, then to-do; within each group earliest
  // deadline first (no deadline last), then most recently created.
  const statusOrder = { in_progress: 0, todo: 1 };
  const sortActive = (a, b) => {
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status] - statusOrder[b.status];
    }
    const ad = getDeadlineTs(a.deadlineAt) ?? Infinity;
    const bd = getDeadlineTs(b.deadlineAt) ?? Infinity;
    if (ad !== bd) return ad - bd;
    return b.createdAt - a.createdAt;
  };
  const sortRecent = (a, b) => b.createdAt - a.createdAt;

  const isEmpty = tasks.length === 0;

  return (
    <div className="task-tab">
      <div className="task-table-scroll">
        <div className="task-table">
          <button
            type="button"
            className="task-add-trigger"
            onClick={onCreate}
          >
            <span className="task-add-icon" aria-hidden="true">
              +
            </span>
            <span>
              {isEmpty
                ? `Add your first task${isAll ? '' : ` for ${newArea.name}`}`
                : 'Add a task'}
            </span>
          </button>

          <div className="task-table-header">
            <span className="task-col-title">Title</span>
            <span className="task-col-status">Status</span>
            <span className="task-col-area">Area</span>
            <span className="task-col-deadline">Deadline</span>
            <span className="task-col-actions" />
          </div>

          {isEmpty && (
            <div className="empty-state">
              <div className="empty-icon">∅</div>
              <div className="empty-title">No tasks yet</div>
              <div className="empty-sub">
                Click above to add your first task.
              </div>
            </div>
          )}

          {active.length > 0 &&
            [...active].sort(sortActive).map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onEdit={() => onEdit(t.id)}
                onChangeStatus={(s) => setStatus(t.id, s)}
                onDelete={() => deleteTask(t.id)}
              />
            ))}

          {completed.length > 0 && (
            <>
              <div className="task-section-divider">
                <span>completed · {completed.length}</span>
              </div>
              {[...completed].sort(sortRecent).map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onEdit={() => onEdit(t.id)}
                  onChangeStatus={(s) => setStatus(t.id, s)}
                  onDelete={() => deleteTask(t.id)}
                />
              ))}
            </>
          )}

          {rejected.length > 0 && (
            <>
              <div className="task-section-divider">
                <span>rejected · {rejected.length}</span>
              </div>
              {[...rejected].sort(sortRecent).map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onEdit={() => onEdit(t.id)}
                  onChangeStatus={(s) => setStatus(t.id, s)}
                  onDelete={() => deleteTask(t.id)}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskRow({ task, onEdit, onChangeStatus, onDelete }) {
  const status = TASK_STATUS_BY_ID[task.status] || TASK_STATUS_BY_ID.todo;
  const area = AREA_BY_ID[task.areaId] || AREAS[0];
  const deadline = fmtDeadline(task.deadlineAt);
  const deadlineDisplay = deadline ? deadline.dateLabel : '—';
  const deadlineTime = deadline?.timeLabel || '';
  // Description and the created/modified/completed timestamps are reference
  // data: you look them up when you open a task, not while scanning the list,
  // so they live in the drawer rather than the table.
  const overdue =
    deadline?.overdue &&
    task.status !== 'done' &&
    task.status !== 'rejected';

  return (
    <div
      className={`task-row-data status-${task.status}`}
      style={{ '--status-color': status.color }}
      onClick={onEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit();
        }
      }}
    >
      <div
        className={`task-cell-title-display task-col-title ${
          task.title ? '' : 'is-empty'
        }`}
        title={task.title || 'Untitled task'}
      >
        {task.title || 'Untitled task'}
      </div>
      <div
        className="task-col-status"
        onClick={(e) => e.stopPropagation()}
      >
        <select
          className="task-status-select"
          value={task.status}
          onChange={(e) => onChangeStatus(e.target.value)}
          aria-label="Task status"
          style={{ '--status-color': status.color }}
        >
          {TASK_STATUS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="task-col-area">
        <span
          className="task-area-pill"
          style={{ '--accent': area.color }}
          title={`Area: ${area.name}`}
        >
          <span className="task-area-dot" />
          {area.name}
        </span>
      </div>
      <div
        className={`task-cell-deadline task-col-deadline ${
          overdue ? 'is-overdue' : ''
        }`}
        title={deadline?.tooltip || ''}
      >
        {deadline ? (
          <>
            <span className="task-cell-deadline-date">
              {deadlineDisplay}
            </span>
            {deadlineTime && (
              <span className="task-cell-deadline-time">
                {deadlineTime}
              </span>
            )}
          </>
        ) : (
          <span className="task-cell-deadline-empty">—</span>
        )}
      </div>
      <button
        type="button"
        className="row-delete task-col-actions"
        aria-label="Delete task"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        ×
      </button>
    </div>
  );
}

function fmtTs(ts) {
  if (ts == null) return { label: '—', tooltip: '' };
  const d = new Date(ts);
  const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const label = d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  });
  return { label, tooltip: `${key} · ${time}` };
}

function fmtDateKey(key) {
  if (!key) return '—';
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Normalize a task's deadlineAt (timestamp number, legacy 'YYYY-MM-DD'
// string, or null) to an epoch-ms timestamp. Legacy end-of-day strings
// map to 23:59 local time on that date.
function getDeadlineTs(deadlineAt) {
  if (deadlineAt == null) return null;
  if (typeof deadlineAt === 'number') return deadlineAt;
  const [y, m, d] = deadlineAt.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 0, 0).getTime();
}

// Render a deadline as a { date, time, overdue, tooltip } record.
function fmtDeadline(deadlineAt) {
  const ts = getDeadlineTs(deadlineAt);
  if (ts == null) return null;
  const d = new Date(ts);
  const dateLabel = d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  const isEndOfDay = d.getHours() === 23 && d.getMinutes() === 59;
  const timeLabel = isEndOfDay
    ? null
    : d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
  const overdue = ts < Date.now();
  const tooltip = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { dateLabel, timeLabel, overdue, tooltip, ts };
}

// Add n days to a 'YYYY-MM-DD' date key, returning a new key.
function addDays(dateKey, n) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return todayKey(dt);
}

// Return the 'YYYY-MM-DD' date key for a task's deadlineAt.
function deadlineDateKey(deadlineAt) {
  const ts = getDeadlineTs(deadlineAt);
  if (ts == null) return null;
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ----------------------------------------------------------------------------
// Task drawer — slide-in panel for creating and editing tasks
// ----------------------------------------------------------------------------

function TaskDrawer({
  open,
  mode,
  task,
  initialAreaId,
  isAll,
  onClose,
  onSave,
  onDelete
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('todo');
  const [areaId, setAreaId] = useState(initialAreaId);
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deadlineTime, setDeadlineTime] = useState('23:59');

  const titleRef = useRef(null);

  // Reset form whenever the drawer opens or the underlying task swaps.
  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && task) {
      setTitle(task.title || '');
      setDescription(task.description || '');
      setStatus(task.status || 'todo');
      setAreaId(task.areaId || initialAreaId);
      const ts = getDeadlineTs(task.deadlineAt);
      if (ts != null) {
        const d = new Date(ts);
        setDeadlineDate(
          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        );
        const isEndOfDay = d.getHours() === 23 && d.getMinutes() === 59;
        setDeadlineTime(
          isEndOfDay
            ? '23:59'
            : `${pad(d.getHours())}:${pad(d.getMinutes())}`
        );
      } else {
        setDeadlineDate('');
        setDeadlineTime('23:59');
      }
    } else {
      setTitle('');
      setDescription('');
      setStatus('todo');
      setAreaId(initialAreaId);
      setDeadlineDate('');
      setDeadlineTime('23:59');
    }
  }, [open, mode, task, initialAreaId]);

  // Autofocus the title input when the drawer opens.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => titleRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const setQuickDeadline = (offsetDays) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    setDeadlineDate(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    );
    setDeadlineTime('23:59');
  };

  const clearDeadline = () => {
    setDeadlineDate('');
    setDeadlineTime('23:59');
  };

  const buildDeadlineTs = () => {
    if (!deadlineDate) return null;
    const [y, m, d] = deadlineDate.split('-').map(Number);
    const [h, min] = (deadlineTime || '23:59').split(':').map(Number);
    return new Date(y, m - 1, d, h, min, 0, 0).getTime();
  };

  const handleSave = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const now = Date.now();
    const deadlineTs = buildDeadlineTs();
    if (mode === 'create') {
      onSave({
        id: uid('t'),
        title: trimmed,
        description: description.trim(),
        status,
        areaId,
        createdAt: now,
        modifiedAt: now,
        completedAt: status === 'done' ? now : null,
        deadlineAt: deadlineTs
      });
    } else if (task) {
      onSave({
        ...task,
        title: trimmed,
        description: description.trim(),
        status,
        areaId,
        modifiedAt: now,
        completedAt:
          status === 'done' ? task.completedAt || now : null,
        deadlineAt: deadlineTs
      });
    }
    onClose();
  };

  const handleDelete = () => {
    if (mode === 'edit' && task) {
      onDelete(task.id);
      onClose();
    }
  };

  if (!open) return null;

  const area = AREA_BY_ID[areaId] || AREAS[0];
  const headerEyebrow = mode === 'create' ? 'New task' : 'Edit task';
  const headerTitle =
    mode === 'create'
      ? 'Untitled task'
      : (task?.title || 'Untitled task');

  return (
    <>
      <div
        className="task-drawer-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="task-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={headerEyebrow}
      >
        <header className="task-drawer-header">
          <div>
            <div className="task-drawer-eyebrow">{headerEyebrow}</div>
            <h2 className="task-drawer-title">{headerTitle}</h2>
          </div>
          <button
            type="button"
            className="task-drawer-close"
            onClick={onClose}
            aria-label="Close drawer"
          >
            ×
          </button>
        </header>

        <div className="task-drawer-body">
          <label className="task-drawer-field">
            <span className="task-drawer-label">Title</span>
            <input
              ref={titleRef}
              className="task-drawer-input task-drawer-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSave();
                }
              }}
            />
          </label>

          <div className="task-drawer-field">
            <span className="task-drawer-label">Status</span>
            <div className="task-drawer-status">
              {TASK_STATUS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`task-drawer-status-btn ${
                    status === s.id ? 'is-active' : ''
                  }`}
                  style={{ '--status-color': s.color }}
                  onClick={() => setStatus(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {isAll && (
            <div className="task-drawer-field">
              <span className="task-drawer-label">Area</span>
              <div
                className="task-drawer-area-row"
                style={{ '--accent': area.color }}
              >
                <span className="task-area-dot" />
                <select
                  className="task-drawer-select"
                  value={areaId}
                  onChange={(e) => setAreaId(e.target.value)}
                  aria-label="Task area"
                >
                  {AREAS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="task-drawer-field">
            <span className="task-drawer-label">Deadline</span>
            <div className="task-drawer-deadline">
              <div className="task-drawer-deadline-row">
                <input
                  type="date"
                  className="task-drawer-date"
                  value={deadlineDate}
                  onChange={(e) => setDeadlineDate(e.target.value)}
                />
                <input
                  type="time"
                  className="task-drawer-time"
                  value={deadlineTime}
                  step={900}
                  disabled={!deadlineDate}
                  onChange={(e) =>
                    setDeadlineTime(e.target.value || '23:59')
                  }
                />
              </div>
              <div className="task-drawer-quick">
                <button type="button" onClick={() => setQuickDeadline(0)}>
                  Today
                </button>
                <button type="button" onClick={() => setQuickDeadline(1)}>
                  Tomorrow
                </button>
                <button type="button" onClick={() => setQuickDeadline(7)}>
                  +1 week
                </button>
                <button type="button" onClick={clearDeadline}>
                  Clear
                </button>
              </div>
            </div>
          </div>

          <label className="task-drawer-field">
            <span className="task-drawer-label">Description</span>
            <textarea
              className="task-drawer-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add details…"
              rows={4}
            />
          </label>

          {mode === 'edit' && task && (
            <div className="task-drawer-meta">
              <span>
                <span className="task-drawer-meta-key">Created</span>
                {fmtTs(task.createdAt).label}
              </span>
              <span>
                <span className="task-drawer-meta-key">Modified</span>
                {fmtTs(task.modifiedAt).label}
              </span>
              {task.completedAt && (
                <span>
                  <span className="task-drawer-meta-key">Completed</span>
                  {fmtTs(task.completedAt).label}
                </span>
              )}
            </div>
          )}
        </div>

        <footer className="task-drawer-footer">
          {mode === 'edit' && (
            <button
              type="button"
              className="task-drawer-delete"
              onClick={handleDelete}
            >
              Delete
            </button>
          )}
          <div className="task-drawer-footer-right">
            <button
              type="button"
              className="task-drawer-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="task-drawer-save"
              onClick={handleSave}
              disabled={!title.trim()}
            >
              {mode === 'create' ? 'Create task' : 'Save changes'}
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}

// ----------------------------------------------------------------------------
// Journal view
// ----------------------------------------------------------------------------

function JournalView({
  journalData,
  onSaveEntry,
  viewingDate,
  setViewingDate,
  today
}) {
  // Date is now owned by the app — keep local editor state in sync.
  const [draftMood, setDraftMood] = useState(null);
  const [draftTags, setDraftTags] = useState([]);
  const [draftText, setDraftText] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const currentYear = Number(today.slice(0, 4));
  const [graphYear, setGraphYear] = useState(currentYear);

  // Year grid behind the presence graph.
  const graphGrid = useMemo(() => buildYearGrid(graphYear), [graphYear]);

  const mood = draftMood;
  const tags = draftTags;
  const text = draftText;
  const setMood = setDraftMood;
  const setTags = setDraftTags;
  const setText = setDraftText;

  // Hydrate from saved entry whenever the date changes.
  useEffect(() => {
    const existing = journalData[viewingDate] || null;
    setDraftMood(existing?.mood || null);
    setDraftTags(existing?.tags || []);
    setDraftText(existing?.text || '');
    setSavedAt(existing?.savedAt || null);
  }, [viewingDate, journalData]);

  const toggleTag = (areaId) => {
    setDraftTags((prev) =>
      prev.includes(areaId)
        ? prev.filter((t) => t !== areaId)
        : [...prev, areaId]
    );
  };

  const onSave = () => {
    const entry = {
      mood: draftMood,
      tags: draftTags,
      text: draftText.trim(),
      savedAt: Date.now()
    };
    onSaveEntry(viewingDate, entry);
    const stamp = entry.savedAt;
    setSavedAt(stamp);
    setTimeout(() => setSavedAt((v) => (v === stamp ? null : v)), 2400);
  };

  return (
    <section className="journal-view">
      <div className="journal-graph">
        <header className="year-header journal-graph-header">
          <div>
            <div className="year-eyebrow">Entries by day</div>
            <h2 className="section-title daily-graph-title">{graphYear}</h2>
          </div>
          <div className="year-nav">
            <button
              type="button"
              className="year-nav-btn"
              onClick={() => setGraphYear((y) => y - 1)}
              aria-label="Previous year"
            >
              ←
            </button>
            {graphYear !== currentYear && (
              <button
                type="button"
                className="year-today-btn"
                onClick={() => setGraphYear(currentYear)}
              >
                Today
              </button>
            )}
            <button
              type="button"
              className="year-nav-btn"
              onClick={() => setGraphYear((y) => Math.min(currentYear, y + 1))}
              disabled={graphYear >= currentYear}
              aria-label="Next year"
            >
              →
            </button>
          </div>
        </header>
        <YearHeatmap
          grid={graphGrid}
          today={today}
          year={graphYear}
          // Binary on purpose: every written day looks the same, so the grid
          // shows presence without ranking one day above another.
          levelFor={(k) => journalLevel(journalData, k)}
          tipFor={(k) => journalTipLines(journalData, k)}
          onSelect={(k) => {
            setViewingDate(k);
            setGraphYear(Number(k.slice(0, 4)));
          }}
          legendHint="· click any day to open it"
          tipClassName="heatmap-tip-wrap-text"
        />
      </div>

      <div className="journal-editor">
        <header className="section-header journal-header">
          <div>
            <div className="section-eyebrow">Reflect</div>
            <h1 className="section-title-lg">Journal</h1>
          </div>
          <span className="section-meta">{formatDate(viewingDate)}</span>
        </header>

        <div className="journal-controls">
          <div className="journal-date">
            <span className="control-label">date</span>
            <input
              type="date"
              className="date-input"
              value={viewingDate}
              max={today}
              onChange={(e) => {
                const next = e.target.value;
                if (!next) return;
                setViewingDate(next > today ? today : next);
              }}
            />
          </div>
          <div className="journal-mood">
            <span className="control-label">mood</span>
            <div className="mood-row">
              {MOODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`mood-btn ${mood === m.id ? 'is-active' : ''}`}
                  onClick={() => setMood(m.id)}
                  aria-label={m.label}
                  title={m.label}
                >
                  <span className="mood-emoji">{m.emoji}</span>
                  <span className="mood-label">{m.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="journal-tags">
          <span className="control-label">tags</span>
          <div className="tag-row">
            {AREAS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`tag-pill ${tags.includes(a.id) ? 'is-active' : ''}`}
                style={
                  tags.includes(a.id)
                    ? { borderColor: a.color, color: a.color }
                    : undefined
                }
                onClick={() => toggleTag(a.id)}
              >
                {a.name}
              </button>
            ))}
          </div>
        </div>

        <textarea
          className="journal-textarea"
          placeholder="What's on your mind?"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <div className="journal-actions">
          <button type="button" className="save-btn" onClick={onSave}>
            Save entry
          </button>
          {savedAt && (
            <span className="save-confirm">
              ✓ saved · {formatTime(savedAt)}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  });
}

// ----------------------------------------------------------------------------
// Daily view — vibe (Map of Consciousness), stress, energy
// ----------------------------------------------------------------------------

const STRESS_LABELS = [
  null,
  'Very low',
  'Very low',
  'Low',
  'Low',
  'Medium',
  'Medium',
  'High',
  'High',
  'Very high',
  'Very high'
];

const ENERGY_LABELS = [
  null,
  'Depleted',
  'Depleted',
  'Low',
  'Low',
  'Steady',
  'Steady',
  'Strong',
  'Strong',
  'Peak',
  'Peak'
];

function metricLabel(value, labels) {
  if (value == null) return '—';
  return labels[Math.max(1, Math.min(10, value))] || '—';
}

function DailyView({
  dailyData,
  taskData,
  habitData,
  habits,
  journalData,
  viewingDate,
  setViewingDate,
  today,
  onOpenTask,
  onOpenHabits,
  onOpenJournal,
  onSaveCheckIn,
  onClearCheckIn,
  onSaveWeight,
  onClearWeight,
  weightData,
  weightUnit,
  setWeightUnit
}) {
  const [checkInOpen, setCheckInOpen] = useState(false);
  const currentYear = Number(today.slice(0, 4));
  const [graphYear, setGraphYear] = useState(currentYear);

  const entry = dailyData[viewingDate] || null;
  const vibeInfo = entry?.vibe != null ? HAWKINS_BY_VALUE[entry.vibe] : null;

  // Year grid behind the check-in graph.
  const graphGrid = useMemo(() => buildYearGrid(graphYear), [graphYear]);

  // Aggregate tasks across all areas for the deadline overview.
  const allTasks = useMemo(() => {
    const out = [];
    for (const a of AREAS) {
      for (const t of taskData[a.id] || []) {
        out.push(t.areaId ? t : { ...t, areaId: a.id });
      }
    }
    return out;
  }, [taskData]);

  // Group open tasks by deadline horizon.
  const grouped = useMemo(() => {
    const overdue = [];
    const todayList = [];
    const tomorrowList = [];
    const weekList = [];
    const tomorrowKey = addDays(viewingDate, 1);
    const weekEndKey = addDays(viewingDate, 7);
    for (const t of allTasks) {
      if (t.status === 'done' || t.status === 'rejected') continue;
      if (t.deadlineAt == null) continue;
      const dk = deadlineDateKey(t.deadlineAt);
      if (!dk) continue;
      if (dk < viewingDate) overdue.push(t);
      else if (dk === viewingDate) todayList.push(t);
      else if (dk === tomorrowKey) tomorrowList.push(t);
      else if (dk <= weekEndKey) weekList.push(t);
    }
    // Sort by time within each bucket (earliest first).
    const byTime = (a, b) =>
      getDeadlineTs(a.deadlineAt) - getDeadlineTs(b.deadlineAt);
    overdue.sort(byTime);
    todayList.sort(byTime);
    tomorrowList.sort(byTime);
    weekList.sort(byTime);
    return { overdue, today: todayList, tomorrow: tomorrowList, week: weekList };
  }, [allTasks, viewingDate]);

  // Habits done today.
  const habitsToday = useMemo(() => {
    const dayData = habitData[viewingDate] || {};
    let done = 0;
    for (const h of habits) {
      if (dayData[h.id]) done++;
    }
    return { done, total: habits.length };
  }, [habitData, habits, viewingDate]);

  // Journal preview for today.
  const journalEntry = journalData[viewingDate];
  const journalPreview = journalEntry?.text
    ? journalEntry.text.length > 140
      ? journalEntry.text.slice(0, 140) + '…'
      : journalEntry.text
    : null;
  const journalMood = journalEntry?.mood
    ? MOODS.find((m) => m.id === journalEntry.mood)
    : null;

  // ---- Weight ------------------------------------------------------------
  // One reading per day, stored in kg regardless of display unit.
  const weightForDate = weightData[viewingDate] || null;
  const weightKg = weightForDate?.kg ?? null;
  const series = useMemo(() => weightSeries(weightData), [weightData]);
  const meanSeries = useMemo(() => rollingMean(series), [series]);
  const changeAllTime = useMemo(() => totalChange(series), [series]);
  const ratePerWeek = useMemo(() => weeklyRate(series), [series]);

  // Tooltip lines for a day's check-in. Also the cell's aria-label.
  const tipForDay = (key) => {
    const e = dailyData[key];
    if (!e || (e.vibe == null && e.stress == null && e.energy == null)) {
      return ['No check-in'];
    }
    const out = [];
    if (e.vibe != null) {
      const v = HAWKINS_BY_VALUE[e.vibe];
      out.push(v ? `Vibe ${v.value} · ${v.name}` : `Vibe ${e.vibe}`);
    }
    if (e.stress != null)
      out.push(`Stress ${e.stress} · ${metricLabel(e.stress, STRESS_LABELS)}`);
    if (e.energy != null)
      out.push(`Energy ${e.energy} · ${metricLabel(e.energy, ENERGY_LABELS)}`);
    return out;
  };

  const tomorrowKey = addDays(viewingDate, 1);
  const isToday = viewingDate === today;
  const isPast = viewingDate < today;
  const isEmpty =
    grouped.overdue.length === 0 &&
    grouped.today.length === 0 &&
    grouped.tomorrow.length === 0 &&
    grouped.week.length === 0;

  return (
    <section className="daily-view">
      <div className="daily-graph">
        <header className="year-header daily-graph-header">
          <div>
            <div className="year-eyebrow">Check-in year</div>
            <h2 className="section-title daily-graph-title">{graphYear}</h2>
          </div>
          <div className="year-nav">
            <button
              type="button"
              className="year-nav-btn"
              onClick={() => setGraphYear((y) => y - 1)}
              aria-label="Previous year"
            >
              ←
            </button>
            {graphYear !== currentYear && (
              <button
                type="button"
                className="year-today-btn"
                onClick={() => setGraphYear(currentYear)}
              >
                Today
              </button>
            )}
            <button
              type="button"
              className="year-nav-btn"
              onClick={() => setGraphYear((y) => Math.min(currentYear, y + 1))}
              disabled={graphYear >= currentYear}
              aria-label="Next year"
            >
              →
            </button>
          </div>
        </header>
        <YearHeatmap
          grid={graphGrid}
          today={today}
          year={graphYear}
          levelFor={(k) => levelFromVibe(dailyData[k]?.vibe)}
          tipFor={tipForDay}
          onSelect={(k) => {
            setViewingDate(k);
            setGraphYear(Number(k.slice(0, 4)));
          }}
          legendHint="· click any day to open it"
        />
      </div>

      <div className="daily-overview">
        <header className="section-header daily-overview-header">
          <div>
            <div className="section-eyebrow">
              {isToday ? 'Today' : isPast ? 'Past' : 'Future'}
            </div>
            <h1 className="section-title-lg">{formatDate(viewingDate)}</h1>
          </div>
          <div className="daily-overview-actions">
            <input
              type="date"
              className="date-input"
              value={viewingDate}
              max={today}
              onChange={(e) => {
                const next = e.target.value;
                if (!next) return;
                setViewingDate(next > today ? today : next);
              }}
              aria-label="Viewing date"
            />
            {!isToday && (
              <button
                type="button"
                className="today-btn"
                onClick={() => setViewingDate(today)}
              >
                ← Today
              </button>
            )}
          </div>
        </header>

        {/* Check-in summary card */}
        <button
          type="button"
          className={`daily-checkin-card ${entry ? 'is-filled' : 'is-empty'}`}
          onClick={() => setCheckInOpen(true)}
        >
          <div className="daily-checkin-vibe">
            <span
              className="daily-summary-swatch"
              style={{
                backgroundColor: vibeInfo ? vibeInfo.color : 'transparent',
                borderColor: vibeInfo ? vibeInfo.color : 'var(--border)'
              }}
            />
            <div className="daily-summary-text">
              <span className="daily-summary-eyebrow">vibe</span>
              <span className="daily-summary-value">
                {vibeInfo ? `${vibeInfo.name} · ${vibeInfo.value}` : 'Not set'}
              </span>
            </div>
          </div>
          <div className="daily-checkin-meta">
            <div className="daily-checkin-meta-item">
              <span className="daily-checkin-meta-key">stress</span>
              <span className="daily-checkin-meta-value">
                {entry?.stress != null ? `${entry.stress} · ${metricLabel(entry.stress, STRESS_LABELS)}` : '—'}
              </span>
            </div>
            <div className="daily-checkin-meta-item">
              <span className="daily-checkin-meta-key">energy</span>
              <span className="daily-checkin-meta-value">
                {entry?.energy != null ? `${entry.energy} · ${metricLabel(entry.energy, ENERGY_LABELS)}` : '—'}
              </span>
            </div>
            {/* Change is week-over-week and all-time, never day-over-day:
                day-to-day movement is mostly water and would be misleading. */}
            <div className="daily-checkin-meta-item">
              <span className="daily-checkin-meta-key">weight</span>
              <span className="daily-checkin-meta-value">
                {weightKg != null ? formatWeight(weightKg, weightUnit) : '—'}
              </span>
            </div>
            <div className="daily-checkin-meta-item">
              <span className="daily-checkin-meta-key">change</span>
              <span className="daily-checkin-meta-value">
                {changeAllTime != null ? `${formatDelta(changeAllTime, weightUnit)} all` : '—'}
                {ratePerWeek != null && ` · ${formatDelta(ratePerWeek, weightUnit)}/wk`}
              </span>
            </div>
          </div>
          <span className="daily-checkin-edit">
            {entry ? 'Edit' : 'Log →'}
          </span>
        </button>

        {/* Journal preview — sits directly under the check-in card so
            "how I am" and "what I wrote" read as one block. */}
        <section className="daily-journal-card">
          <header className="daily-journal-head">
            <span className="control-label">Journal</span>
            <button
              type="button"
              className="daily-journal-open"
              onClick={onOpenJournal}
            >
              {journalPreview ? 'Open →' : 'Write →'}
            </button>
          </header>
          {journalPreview ? (
            <div className="daily-journal-body">
              {journalMood && (
                <span className="daily-journal-mood">
                  <span className="mood-emoji">{journalMood.emoji}</span>
                  <span className="mood-label">{journalMood.label}</span>
                </span>
              )}
              <p className="daily-journal-preview">{journalPreview}</p>
            </div>
          ) : (
            <p className="daily-journal-empty">No entry for this day.</p>
          )}
        </section>

        {/* Habits today mini-summary */}
        <button
          type="button"
          className="daily-habits-mini"
          onClick={() => onOpenHabits && onOpenHabits()}
          title="Open habits view"
        >
          <span className="daily-habits-mini-label">Habits</span>
          <span className="daily-habits-mini-count">
            {habitsToday.done} / {habitsToday.total}
          </span>
          <div className="daily-habits-mini-dots">
            {habits.map((h) => (
              <span
                key={h.id}
                className={`daily-habits-mini-dot ${
                  habitData[viewingDate]?.[h.id] ? 'is-done' : ''
                }`}
                title={h.name}
              />
            ))}
          </div>
        </button>

        {/* Overdue */}
        {grouped.overdue.length > 0 && (
          <DeadlineSection
            title="Overdue"
            tone="danger"
            tasks={grouped.overdue}
            viewingDate={viewingDate}
            onTaskClick={onOpenTask}
          />
        )}

        {/* Today */}
        <DeadlineSection
          title="Today"
          tone="primary"
          tasks={grouped.today}
          viewingDate={viewingDate}
          onTaskClick={onOpenTask}
          emptyMessage={isToday ? 'Nothing due today' : 'Nothing due this day'}
        />

        {/* Tomorrow */}
        <DeadlineSection
          title={`Tomorrow · ${formatShortDay(tomorrowKey)}`}
          tone="secondary"
          tasks={grouped.tomorrow}
          viewingDate={viewingDate}
          onTaskClick={onOpenTask}
          emptyMessage="Clear tomorrow"
        />

        {/* This week */}
        <DeadlineSection
          title="This week"
          tone="muted"
          tasks={grouped.week}
          viewingDate={viewingDate}
          onTaskClick={onOpenTask}
          emptyMessage="Clear week"
          collapsed
        />

        {/* Empty state if nothing happening */}
        {isEmpty && isToday && (
          <div className="daily-empty">
            <div className="daily-empty-icon">○</div>
            <div className="daily-empty-title">Clear schedule</div>
            <div className="daily-empty-sub">
              No deadlines today or this week. Enjoy the space.
            </div>
          </div>
        )}

        {/* Weight trend: raw readings behind a 7-day mean. Sits at the
            bottom as background context rather than a headline metric. */}
        <WeightChart
          series={series}
          meanSeries={meanSeries}
          changeAllTime={changeAllTime}
          ratePerWeek={ratePerWeek}
          unit={weightUnit}
          onUnitChange={setWeightUnit}
        />
      </div>

      <CheckInDrawer
        open={checkInOpen}
        onClose={() => setCheckInOpen(false)}
        entry={entry}
        dateKey={viewingDate}
        onSave={(newEntry) => {
          onSaveCheckIn(viewingDate, newEntry);
          setCheckInOpen(false);
        }}
        onClear={() => {
          onClearCheckIn(viewingDate);
          setCheckInOpen(false);
        }}
        weightEntry={weightForDate}
        weightUnit={weightUnit}
        onSaveWeight={(kg) => onSaveWeight(viewingDate, kg)}
        onClearWeight={() => onClearWeight(viewingDate)}
      />
    </section>
  );
}

// ----------------------------------------------------------------------------
// Deadline section — used in Daily overview for overdue/today/tomorrow/week
// ----------------------------------------------------------------------------

function DeadlineSection({
  title,
  tone,
  tasks,
  viewingDate,
  onTaskClick,
  emptyMessage,
  collapsed
}) {
  const [expanded, setExpanded] = useState(!collapsed);
  const isEmpty = tasks.length === 0;

  return (
    <section className={`daily-section daily-section-${tone}`}>
      <header
        className="daily-section-head"
        onClick={isEmpty ? undefined : () => setExpanded((v) => !v)}
      >
        <span className="daily-section-title">{title}</span>
        <span className="daily-section-count">{tasks.length}</span>
        {!isEmpty && collapsed && (
          <span className="daily-section-toggle">
            {expanded ? '−' : '+'}
          </span>
        )}
      </header>
      {isEmpty ? (
        <div className="daily-section-empty">{emptyMessage}</div>
      ) : expanded ? (
        <ul className="daily-section-list">
          {tasks.map((t) => {
            const area = AREA_BY_ID[t.areaId] || AREAS[0];
            const dl = fmtDeadline(t.deadlineAt);
            const dk = deadlineDateKey(t.deadlineAt);
            const lateBy =
              tone === 'danger' && dk && viewingDate
                ? daysBetween(dk, viewingDate)
                : 0;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  className="daily-task-row"
                  onClick={() => onTaskClick && onTaskClick(t)}
                  title={dl?.tooltip || ''}
                >
                  <span className="daily-task-title">
                    {t.title || 'Untitled task'}
                  </span>
                  <span
                    className="task-area-pill daily-task-area"
                    style={{ '--accent': area.color }}
                  >
                    <span className="task-area-dot" />
                    {area.name}
                  </span>
                  <span className="daily-task-time">
                    {dl?.timeLabel ||
                      (tone === 'danger'
                        ? `${lateBy}d late`
                        : 'today')}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

// ----------------------------------------------------------------------------
// Check-in drawer — slide-in panel for the daily vibe / stress / energy
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Weight — raw daily readings behind a 7-day moving mean
// ----------------------------------------------------------------------------

// The y-domain is deliberately not anchored at zero. A zero-based axis would
// flatten a real 2 kg loss into a straight line; a tightly auto-fitted one
// would render the same loss as a cliff. Pad the actual data range instead,
// and only widen it if the spread is too small to show any shape at all.
function weightDomain(values) {
  if (values.length === 0) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  // Floor the span so a very steady week still shows some movement.
  const padded = Math.max(span * 1.35, span + 0.6, 1);
  const mid = (max + min) / 2;
  return [mid - padded / 2, mid + padded / 2];
}

function WeightChart({
  series,
  meanSeries,
  changeAllTime,
  ratePerWeek,
  unit,
  onUnitChange
}) {
  // Metric in kg; imperial plotted in lb. A stones axis would need ~0.5 st
  // steps (7 lb), far too coarse to show a 1 lb weekly change, so the axis
  // uses the smaller natural unit and the st·lb compound appears in the
  // readout, tooltip and input instead.
  const toPlot = (kg) => (unit === 'stlb' ? kgToLb(kg) : kg);
  const axisUnit = unit === 'stlb' ? 'lb' : 'kg';

  const raw = series.map((p) => ({ key: p.key, y: toPlot(p.kg) }));
  const meanLookup = {};
  for (const p of meanSeries) meanLookup[p.key] = toPlot(p.mean);
  // Recharts wants one dataset per chart, with each series reading a key
  // from it. Days with no mean are null so the line can span them.
  const chartData = raw.map((p) => ({
    key: p.key,
    reading: p.y,
    mean: meanLookup[p.key] ?? null
  }));
  const domain = weightDomain([...raw.map((p) => p.y), ...meanSeries.map((p) => toPlot(p.mean))]);

  const firstKey = series.length > 0 ? series[0].key : null;

  return (
    <section className="weight-card">
      <header className="weight-card-head">
        <div>
          <span className="control-label">Weight</span>
          <div className="weight-card-figures">
            <span className="weight-card-change">
              {changeAllTime != null ? formatDelta(changeAllTime, unit) : '—'}
            </span>
            <span className="weight-card-change-sub">
              {changeAllTime != null
                ? `since ${formatDate(firstKey)}`
                : 'log a few days to see a trend'}
            </span>
            {ratePerWeek != null && (
              <span className="weight-card-rate">
                {formatDelta(ratePerWeek, unit)}/wk
              </span>
            )}
          </div>
        </div>
        <div className="weight-unit-toggle" role="group" aria-label="Weight unit">
          {WEIGHT_UNITS.map((u) => (
            <button
              key={u.id}
              type="button"
              className={`weight-unit-btn ${unit === u.id ? 'is-active' : ''}`}
              onClick={() => onUnitChange && onUnitChange(u.id)}
              aria-pressed={unit === u.id}
            >
              {u.label}
            </button>
          ))}
        </div>
      </header>

      {raw.length === 0 ? (
        <div className="weight-empty">
          <div className="empty-icon">○</div>
          <div className="empty-title">No weigh-ins yet</div>
          <div className="empty-sub">
            Log your morning weight in the check-in and it will appear here.
          </div>
        </div>
      ) : (
        <div className="weight-chart-wrap">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="key"
                type="category"
                interval="preserveStartEnd"
                tickCount={6}
                tickFormatter={(k) => formatDate(k)}
                tick={{ fontSize: 10, fill: 'var(--text-faint)' }}
                stroke="var(--border)"
              />
              <YAxis
                domain={domain}
                tick={{ fontSize: 10, fill: 'var(--text-faint)' }}
                stroke="var(--border)"
                width={52}
                tickFormatter={(v) => `${Math.round(v * 10) / 10} ${axisUnit}`}
              />
              <Tooltip
                content={<WeightTooltip unit={unit} />}
                cursor={{ stroke: 'var(--border-strong)' }}
              />
              {/* Raw readings: faint, because day-to-day movement is noise. */}
              <Scatter
                dataKey="reading"
                name="reading"
                fill="var(--text-faint)"
                fillOpacity={0.5}
                shape="circle"
                r={2}
                isAnimationActive={false}
              />
              {/* 7-day mean: the actual signal. connectNulls so a gap reads as
                  a continuing trend rather than a break. */}
              <Line
                dataKey="mean"
                name="7-day mean"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="weight-legend" aria-hidden="true">
            <span className="weight-legend-item">
              <span className="weight-legend-dot" /> reading
            </span>
            <span className="weight-legend-item">
              <span className="weight-legend-line" /> 7-day mean
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function WeightTooltip({ active, payload, label, unit }) {
  if (!active || !payload || payload.length === 0) return null;
  const reading = payload.find((p) => p.dataKey === 'reading');
  const avg = payload.find((p) => p.dataKey === 'mean');
  // Plotted values are in lb for imperial; weight.js stores and formats kg.
  const toKg = (v) => (unit === 'stlb' ? lbToKg(v) : v);
  return (
    <div className="weight-tip">
      <div className="tip-date">{formatDate(label)}</div>
      <div className="tip-count">
        {reading ? formatWeight(toKg(reading.value), unit) : 'No reading'}
      </div>
      {avg ? (
        <div className="weight-tip-mean">
          7-day mean {formatWeight(toKg(avg.value), unit)}
        </div>
      ) : null}
    </div>
  );
}

function CheckInDrawer({
  open,
  onClose,
  entry,
  dateKey,
  onSave,
  onClear,
  weightEntry,
  weightUnit,
  onSaveWeight,
  onClearWeight
}) {
  const [vibe, setVibe] = useState(null);
  const [stress, setStress] = useState(null);
  const [energy, setEnergy] = useState(null);
  // Weight lives in its own store, so it keeps its own draft state. Raw
  // strings while typing so partial input like "7." is not clobbered.
  const [wKg, setWKg] = useState('');
  const [wSt, setWSt] = useState('');
  const [wLb, setWLb] = useState('');

  const initialWeightKg = weightEntry?.kg ?? null;

  useEffect(() => {
    if (!open) return;
    setVibe(entry?.vibe ?? null);
    setStress(entry?.stress ?? null);
    setEnergy(entry?.energy ?? null);
    const kg = weightEntry?.kg ?? null;
    if (kg == null) {
      setWKg('');
      setWSt('');
      setWLb('');
    } else if (weightUnit === 'stlb') {
      const { st, lb } = kgToStonesLbs(kg);
      setWSt(String(st));
      setWLb(String(lb));
      setWKg('');
    } else {
      setWKg(kg.toFixed(1));
      setWSt('');
      setWLb('');
    }
  }, [open, entry, weightEntry, weightUnit]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Parse the weight draft into kg, or null if it is blank or implausible.
  const parseWeightKg = () => {
    if (weightUnit === 'stlb') {
      const st = wSt.trim() === '' ? 0 : parseInt(wSt, 10);
      const lb = wLb.trim() === '' ? 0 : parseInt(wLb, 10);
      if (wSt.trim() === '' && wLb.trim() === '') return null;
      if (!Number.isFinite(st) || !Number.isFinite(lb) || st < 0 || lb < 0) return null;
      // 14 lb or more carries into the next stone naturally.
      return isPlausibleKg(stonesLbsToKg(st, lb)) ? stonesLbsToKg(st, lb) : null;
    }
    if (wKg.trim() === '') return null;
    const n = parseFloat(wKg);
    return isPlausibleKg(n) ? n : null;
  };

  const handleSave = () => {
    const hasCheckin = vibe != null || stress != null || energy != null;
    const kg = parseWeightKg();
    const weightBlank = weightUnit === 'stlb'
      ? wSt.trim() === '' && wLb.trim() === ''
      : wKg.trim() === '';

    // Weight saves independently of the check-in record, so you can weigh in
    // without also logging a vibe.
    if (kg != null) {
      if (onSaveWeight) onSaveWeight(kg);
    } else if (weightBlank && initialWeightKg != null) {
      // Cleared a reading that existed: treat as a delete.
      if (onClearWeight) onClearWeight();
    }
    if (hasCheckin && onSave) onSave({ vibe, stress, energy, savedAt: Date.now() });
    onClose();
  };

  const handleClear = () => {
    if (onClear) onClear();
    if (onClearWeight) onClearWeight();
  };

  const vibeInfo = vibe != null ? HAWKINS_BY_VALUE[vibe] : null;

  if (!open) return null;

  return (
    <>
      <div
        className="task-drawer-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="task-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Check-in"
      >
        <header className="task-drawer-header">
          <div>
            <div className="task-drawer-eyebrow">Check-in</div>
            <h2 className="task-drawer-title">
              {formatDate(dateKey)}
            </h2>
          </div>
          <button
            type="button"
            className="task-drawer-close"
            onClick={onClose}
            aria-label="Close drawer"
          >
            ×
          </button>
        </header>

        <div className="task-drawer-body">
          <div className="task-drawer-field">
            <div className="daily-field-head">
              <span className="task-drawer-label">
                Vibe · Map of Consciousness
              </span>
              {vibeInfo && (
                <button
                  type="button"
                  className="daily-clear-btn"
                  onClick={() => setVibe(null)}
                >
                  Clear
                </button>
              )}
            </div>
            <div className="daily-vibe-bands">
              {HAWKINS_BANDS.map((band) => (
                <div key={band.id} className="daily-vibe-band">
                  <div className="daily-vibe-band-label">{band.label}</div>
                  <div className="daily-vibe-band-grid">
                    {HAWKINS_LEVELS.filter((l) => l.band === band.id).map(
                      (l) => (
                        <button
                          key={l.value}
                          type="button"
                          className={`daily-vibe-item ${
                            vibe === l.value ? 'is-selected' : ''
                          }`}
                          style={{ '--vibe-color': l.color }}
                          onClick={() => setVibe(l.value)}
                        >
                          <span className="daily-vibe-swatch" />
                          <span className="daily-vibe-text">
                            <span className="daily-vibe-name">{l.name}</span>
                            <span className="daily-vibe-value">{l.value}</span>
                          </span>
                        </button>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="daily-row">
            <div className="task-drawer-field">
              <div className="daily-field-head">
                <span className="task-drawer-label">Stress</span>
                <span className="daily-field-meta">
                  {metricLabel(stress, STRESS_LABELS)}
                </span>
              </div>
              <div className="daily-meter">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`daily-meter-btn ${
                      stress === n ? 'is-selected' : ''
                    }`}
                    onClick={() => setStress(n)}
                    aria-label={`Stress ${n}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="task-drawer-field">
              <div className="daily-field-head">
                <span className="task-drawer-label">Energy</span>
                <span className="daily-field-meta">
                  {metricLabel(energy, ENERGY_LABELS)}
                </span>
              </div>
              <div className="daily-meter">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`daily-meter-btn ${
                      energy === n ? 'is-selected' : ''
                    }`}
                    onClick={() => setEnergy(n)}
                    aria-label={`Energy ${n}`}
                >
                  {n}
                </button>
                ))}
              </div>
            </div>
          </div>

          {/* Weight — its own store, saved independently of the check-in */}
          <div className="task-drawer-field">
            <div className="daily-field-head">
              <span className="task-drawer-label">Weight</span>
              <span className="daily-field-meta">
                {initialWeightKg != null
                  ? formatWeight(initialWeightKg, weightUnit)
                  : 'not set'}
              </span>
            </div>
            {weightUnit === 'stlb' ? (
              <div className="weight-input-row">
                <label className="weight-input-group">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    className="task-drawer-input weight-input"
                    value={wSt}
                    onChange={(e) => setWSt(e.target.value)}
                    placeholder="0"
                    aria-label="Weight in stones"
                  />
                  <span className="weight-input-suffix">st</span>
                </label>
                <label className="weight-input-group">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="13"
                    step="1"
                    className="task-drawer-input weight-input"
                    value={wLb}
                    onChange={(e) => setWLb(e.target.value)}
                    placeholder="0"
                    aria-label="Weight in pounds"
                  />
                  <span className="weight-input-suffix">lb</span>
                </label>
              </div>
            ) : (
              <label className="weight-input-group">
                <input
                  type="number"
                  inputMode="decimal"
                  min={MIN_KG}
                  max={MAX_KG}
                  step="0.1"
                  className="task-drawer-input weight-input"
                  value={wKg}
                  onChange={(e) => setWKg(e.target.value)}
                  placeholder="0.0"
                  aria-label="Weight in kilograms"
                />
                <span className="weight-input-suffix">kg</span>
              </label>
            )}
          </div>
        </div>


        <footer className="task-drawer-footer">
          {(entry || initialWeightKg != null) && (
            <button
              type="button"
              className="task-drawer-delete"
              onClick={handleClear}
            >
              Clear entry
            </button>
          )}
          <div className="task-drawer-footer-right">
            <button
              type="button"
              className="task-drawer-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="task-drawer-save"
              onClick={handleSave}
            >
              {entry ? 'Save changes' : 'Save check-in'}
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}

// Short weekday label, e.g. 'Wed 28'.
function formatShortDay(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const month = dt.toLocaleDateString(undefined, { month: 'short' });
  const day = dt.getDate();
  const weekday = dt.toLocaleDateString(undefined, { weekday: 'short' });
  return `${weekday} ${month} ${day}`;
}
