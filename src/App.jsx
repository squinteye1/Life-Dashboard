import { useEffect, useMemo, useRef, useState } from 'react';
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
  storage,
  migrateFromV1,
  todayKey,
  formatDate,
  monthLabel,
  dateFromKey,
  uid
} from './storage.js';

// ----------------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------------

// Bring an old-shape task {text, priority, done, createdAt} into the new shape
// {title, description, status, createdAt, modifiedAt, completedAt, deadlineAt}.
// Returns the input unchanged if it's already in the new shape.
function migrateTaskShape(t) {
  if (!t || typeof t !== 'object') return t;
  if (t.title !== undefined) return t;
  const createdAt = t.createdAt || Date.now();
  const done = !!t.done;
  return {
    id: t.id,
    title: t.text || '',
    description: '',
    status: done ? 'done' : 'todo',
    createdAt,
    modifiedAt: createdAt,
    completedAt: done ? createdAt : null,
    deadlineAt: null
  };
}

export default function App() {
  const [view, setView] = useState('habits');
  const [activeAreaId, setActiveAreaId] = useState(AREAS[0].id);
  const [viewingDate, setViewingDate] = useState(todayKey());

  const [habits, setHabits] = useState([]);
  const [habitData, setHabitData] = useState({});
  const [taskData, setTaskData] = useState({});
  const [journalData, setJournalData] = useState({});
  const [dailyData, setDailyData] = useState({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    migrateFromV1();
    const loaded = storage.load();

    const habits = Array.isArray(loaded.habits) && loaded.habits.length
      ? loaded.habits
      : GLOBAL_HABITS.map((h) => ({ ...h }));

    // Migrate tasks from the v1 shape ({text, priority, done, createdAt})
    // into the v2 shape ({title, description, status, createdAt,
    // modifiedAt, completedAt, deadlineAt, areaId}).
    const rawTaskData = loaded.taskData || {};
    const migratedTaskData = {};
    let didMigrate = false;
    for (const [areaId, list] of Object.entries(rawTaskData)) {
      const arr = Array.isArray(list) ? list : [];
      migratedTaskData[areaId] = arr.map((t) => {
        const next = migrateTaskShape(t);
        if (next.areaId !== areaId) {
          didMigrate = true;
          return { ...next, areaId };
        }
        return next;
      });
    }

    setHabits(habits);
    setHabitData(loaded.habitData || {});
    setTaskData(migratedTaskData);
    setJournalData(loaded.journalData || {});
    setDailyData(loaded.dailyData || {});

    if (habits !== loaded.habits) storage.saveHabits(habits);
    if (didMigrate) storage.saveTaskData(migratedTaskData);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hydrated) storage.saveHabits(habits);
  }, [habits, hydrated]);
  useEffect(() => {
    if (hydrated) storage.saveHabitData(habitData);
  }, [habitData, hydrated]);
  useEffect(() => {
    if (hydrated) storage.saveTaskData(taskData);
  }, [taskData, hydrated]);
  useEffect(() => {
    if (hydrated) storage.saveJournalData(journalData);
  }, [journalData, hydrated]);
  useEffect(() => {
    if (hydrated) storage.saveDailyData(dailyData);
  }, [dailyData, hydrated]);

  const today = todayKey();

  // Clamp viewing date — never let it slip into the future.
  const safeViewingDate =
    viewingDate > today ? today : viewingDate;

  return (
    <div className="app">
      <Header
        view={view}
        setView={setView}
        viewingDate={safeViewingDate}
        setViewingDate={setViewingDate}
        today={today}
      />
      <main className="main">
        {view === 'habits' && (
          <HabitsView
            habits={habits}
            habitData={habitData}
            today={today}
            viewingDate={safeViewingDate}
            setViewingDate={setViewingDate}
            setHabitData={setHabitData}
          />
        )}
        {view === 'areas' && (
          <AreasView
            activeAreaId={activeAreaId}
            setActiveAreaId={setActiveAreaId}
            taskData={taskData}
            setTaskData={setTaskData}
          />
        )}
        {view === 'journal' && (
          <JournalView
            journalData={journalData}
            setJournalData={setJournalData}
            viewingDate={safeViewingDate}
            setViewingDate={setViewingDate}
            today={today}
          />
        )}
        {view === 'daily' && (
          <DailyView
            dailyData={dailyData}
            setDailyData={setDailyData}
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
          />
        )}
      </main>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Header
// ----------------------------------------------------------------------------

function Header({ view, setView, viewingDate, setViewingDate, today }) {
  const isToday = viewingDate === today;
  const dateInputRef = useRef(null);

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

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          ◐
        </span>
        <span className="brand-name">LIFE.DASHBOARD</span>
      </div>
      <nav className="topnav" aria-label="Primary">
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
        <button
          type="button"
          className={`nav-pill ${view === 'daily' ? 'is-active' : ''}`}
          onClick={() => setView('daily')}
        >
          Daily
        </button>
      </nav>
      <div className="header-meta">
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
    </header>
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
  setHabitData
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
    setHabitData((prev) => {
      const day = { ...(prev[dateKey] || {}) };
      day[habitId] = !day[habitId];
      const next = { ...prev, [dateKey]: day };
      // Clean up empty days to keep storage tidy.
      if (Object.keys(day).length === 0) delete next[dateKey];
      return next;
    });
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
        habitData={habitData}
        habitTotal={habits.length}
        today={today}
        viewingDate={viewingDate}
        onJumpToDay={jumpToDay}
        year={year}
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

function pad2(n) {
  return String(n).padStart(2, '0');
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

function YearHeatmap({ grid, habitData, habitTotal, today, onToggle, year }) {
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
              const completed = countCompleted(habitData[c.key]);
              const level = levelFromCount(completed, habitTotal);
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
                  aria-label={`${c.key} · ${completed} of ${habitTotal}`}
                  onMouseEnter={(e) =>
                    setHovered({
                      key: c.key,
                      completed,
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
                      completed,
                      x: e.currentTarget.getBoundingClientRect().left,
                      y: e.currentTarget.getBoundingClientRect().top
                    })
                  }
                  onBlur={() => setHovered(null)}
                  onClick={() => {
                    // No-op: toggling happens on the habit list below.
                    // The cell stays keyboard-focusable for accessibility.
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
        <span className="legend-hint">· click any day to open it</span>
      </div>

      {hovered && (
        <div
          className="heatmap-tip"
          style={{
            left: hovered.x,
            top: hovered.y
          }}
          role="tooltip"
        >
          <div className="tip-date">{formatDate(hovered.key)}</div>
          <div className="tip-count">
            {hovered.completed} / {habitTotal} completed
          </div>
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
  setTaskData
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

  // setTasks callback for the panel — works on the aggregated list and
  // splits the result back into taskData by areaId.
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
        onSave={(taskData) => {
          if (drawerState?.mode === 'create') {
            setTasks((prev) => [...prev, taskData]);
          } else {
            setTasks((prev) =>
              prev.map((t) => (t.id === taskData.id ? taskData : t))
            );
          }
        }}
        onDelete={(id) => {
          setTasks((prev) => prev.filter((t) => t.id !== id));
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
  onCreate,
  onEdit
}) {
  const newArea = AREA_BY_ID[defaultNewTaskAreaId] || AREAS[0];

  const setStatus = (id, newStatus) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const now = Date.now();
        const completedAt =
          newStatus === 'done' ? t.completedAt || now : null;
        return { ...t, status: newStatus, completedAt, modifiedAt: now };
      })
    );
  };

  const deleteTask = (id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
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
            <span className="task-col-desc">Description</span>
            <span className="task-col-status">Status</span>
            <span className="task-col-area">Area</span>
            <span className="task-col-date task-col-created">Created</span>
            <span className="task-col-date task-col-modified">Modified</span>
            <span className="task-col-date task-col-completed">Completed</span>
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
  const created = fmtTs(task.createdAt);
  const modified = fmtTs(task.modifiedAt);
  const completedDisplay = task.completedAt
    ? fmtTs(task.completedAt).label
    : '—';
  const deadline = fmtDeadline(task.deadlineAt);
  const deadlineDisplay = deadline ? deadline.dateLabel : '—';
  const deadlineTime = deadline?.timeLabel || '';
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
      >
        {task.title || 'Untitled task'}
      </div>
      <div
        className="task-cell-desc-display task-col-desc"
        title={task.description}
      >
        {task.description || '—'}
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
        className="task-cell-date task-col-created"
        title={created.tooltip}
      >
        {created.label}
      </div>
      <div
        className="task-cell-date task-col-modified"
        title={modified.tooltip}
      >
        {modified.label}
      </div>
      <div
        className={`task-cell-date task-col-completed ${
          task.completedAt ? 'has-value' : ''
        }`}
        title={task.completedAt ? fmtTs(task.completedAt).tooltip : ''}
      >
        {completedDisplay}
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
  setJournalData,
  viewingDate,
  setViewingDate,
  today
}) {
  // Date is now owned by the app — keep local editor state in sync.
  const [draftMood, setDraftMood] = useState(null);
  const [draftTags, setDraftTags] = useState([]);
  const [draftText, setDraftText] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

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
    setJournalData((prev) => ({ ...prev, [viewingDate]: entry }));
    const stamp = entry.savedAt;
    setSavedAt(stamp);
    setDrawerOpen(false);
    setTimeout(() => setSavedAt((v) => (v === stamp ? null : v)), 2400);
  };

  // Past = all saved entries other than the current draft date.
  const past = Object.entries(journalData)
    .filter(
      ([d, e]) => e && (e.text || e.mood) && d !== viewingDate
    )
    .sort(([a], [b]) => (a < b ? 1 : -1));

  return (
    <section className="journal-view">
      <div className="journal-editor">
        <header className="section-header journal-header">
          <div>
            <div className="section-eyebrow">Reflect</div>
            <h1 className="section-title-lg">Journal</h1>
          </div>
          <button
            type="button"
            className="entry-toggle"
            onClick={() => setDrawerOpen((v) => !v)}
            aria-expanded={drawerOpen}
          >
            {drawerOpen ? 'Hide past' : `Past · ${past.length}`}
          </button>
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

      {drawerOpen && (
        <aside className="journal-past">
          <header className="section-header journal-past-header">
            <h2 className="section-title">Past entries</h2>
            <span className="section-meta">
              {past.length} {past.length === 1 ? 'entry' : 'entries'}
            </span>
          </header>
          <div className="journal-past-list">
            {past.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon">·</div>
                <div className="empty-title">No past entries</div>
                <div className="empty-sub">
                  Pick another date to start a new one.
                </div>
              </div>
            )}
            {past.map(([d, e]) => (
              <JournalCard key={d} dateKey={d} entry={e} />
            ))}
          </div>
        </aside>
      )}
    </section>
  );
}

function JournalCard({ dateKey, entry }) {
  const moodObj = MOODS.find((m) => m.id === entry.mood);
  const preview = entry.text
    ? entry.text.length > 200
      ? entry.text.slice(0, 200) + '…'
      : entry.text
    : '(no text)';
  return (
    <article className="journal-card">
      <div className="journal-card-top">
        <span className="journal-card-date">{formatDate(dateKey)}</span>
        {moodObj && (
          <span className="journal-card-mood">
            <span className="mood-emoji">{moodObj.emoji}</span>
            <span className="mood-label">{moodObj.label}</span>
          </span>
        )}
      </div>
      {entry.tags && entry.tags.length > 0 && (
        <div className="journal-card-tags">
          {entry.tags.map((tid) => {
            const a = AREA_BY_ID[tid];
            if (!a) return null;
            return (
              <span
                key={tid}
                className="journal-card-tag"
                style={{ color: a.color, borderColor: a.color }}
              >
                {a.name}
              </span>
            );
          })}
        </div>
      )}
      <p className="journal-card-preview">{preview}</p>
    </article>
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
  setDailyData,
  taskData,
  habitData,
  habits,
  journalData,
  viewingDate,
  setViewingDate,
  today,
  onOpenTask,
  onOpenJournal
}) {
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [pastOpen, setPastOpen] = useState(false);

  const entry = dailyData[viewingDate] || null;
  const vibeInfo = entry?.vibe != null ? HAWKINS_BY_VALUE[entry.vibe] : null;

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

  // Past check-ins.
  const past = Object.entries(dailyData)
    .filter(
      ([d, e]) =>
        e &&
        (e.vibe != null || e.stress != null || e.energy != null) &&
        d !== viewingDate
    )
    .sort(([a], [b]) => (a < b ? 1 : -1));

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
            <button
              type="button"
              className="entry-toggle"
              onClick={() => setPastOpen((v) => !v)}
              aria-expanded={pastOpen}
            >
              {pastOpen ? 'Hide past' : `Past · ${past.length}`}
            </button>
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
          </div>
          <span className="daily-checkin-edit">
            {entry ? 'Edit' : 'Log →'}
          </span>
        </button>

        {/* Habits today mini-summary */}
        <button
          type="button"
          className="daily-habits-mini"
          onClick={() => onOpenTask && onOpenTask()}
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

        {/* Journal preview */}
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
      </div>

      {pastOpen && (
        <aside className="daily-past">
          <header className="section-header daily-past-header">
            <h2 className="section-title">Past check-ins</h2>
            <span className="section-meta">
              {past.length} {past.length === 1 ? 'entry' : 'entries'}
            </span>
          </header>
          <div className="daily-past-list">
            {past.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon">·</div>
                <div className="empty-title">No past check-ins</div>
                <div className="empty-sub">
                  Pick another date to start a new one.
                </div>
              </div>
            )}
            {past.map(([d, e]) => {
              const vObj = e.vibe != null ? HAWKINS_BY_VALUE[e.vibe] : null;
              return (
                <button
                  key={d}
                  type="button"
                  className="daily-past-card"
                  onClick={() => setViewingDate(d)}
                >
                  <div className="daily-past-date">{formatDate(d)}</div>
                  <div className="daily-past-metrics">
                    <div className="daily-past-metric">
                      <span
                        className="daily-past-swatch"
                        style={{
                          backgroundColor: vObj
                            ? vObj.color
                            : 'transparent',
                          borderColor: vObj
                            ? vObj.color
                            : 'var(--border)'
                        }}
                      />
                      <span>{vObj ? vObj.name : '—'}</span>
                    </div>
                    <div className="daily-past-meta">
                      <span>S {e.stress ?? '—'}</span>
                      <span>E {e.energy ?? '—'}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>
      )}

      <CheckInDrawer
        open={checkInOpen}
        onClose={() => setCheckInOpen(false)}
        entry={entry}
        dateKey={viewingDate}
        onSave={(newEntry) => {
          setDailyData((prev) => ({ ...prev, [viewingDate]: newEntry }));
          setCheckInOpen(false);
        }}
        onClear={() => {
          setDailyData((prev) => {
            const next = { ...prev };
            delete next[viewingDate];
            return next;
          });
          setCheckInOpen(false);
        }}
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

function CheckInDrawer({ open, onClose, entry, dateKey, onSave, onClear }) {
  const [vibe, setVibe] = useState(null);
  const [stress, setStress] = useState(null);
  const [energy, setEnergy] = useState(null);

  useEffect(() => {
    if (!open) return;
    setVibe(entry?.vibe ?? null);
    setStress(entry?.stress ?? null);
    setEnergy(entry?.energy ?? null);
  }, [open, entry]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleSave = () => {
    if (vibe == null && stress == null && energy == null) {
      onClose();
      return;
    }
    onSave({ vibe, stress, energy, savedAt: Date.now() });
  };

  const handleClear = () => {
    onClear && onClear();
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
        </div>

        <footer className="task-drawer-footer">
          {entry && (
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
