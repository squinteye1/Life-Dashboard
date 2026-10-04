// Domain data — life areas, global habits, journal moods, task priority.
// Colours are pastel accents tuned for the near-black surface palette.

export const AREAS = [
  {
    id: 'health',
    name: 'Health',
    color: '#7fff9f',
    blurb: 'Body, sleep, recovery.'
  },
  {
    id: 'social',
    name: 'Social',
    color: '#ff8fa3',
    blurb: 'Relationships and connection.'
  },
  {
    id: 'environment',
    name: 'Environment',
    color: '#7ee8e0',
    blurb: 'Space, nature, surroundings.'
  },
  {
    id: 'family',
    name: 'Family',
    color: '#ffd47e',
    blurb: 'Closest relationships and home.'
  },
  {
    id: 'finances',
    name: 'Finances',
    color: '#c9a0ff',
    blurb: 'Money, budget, calm.'
  },
  {
    id: 'growth',
    name: 'Growth',
    color: '#88b4ff',
    blurb: 'Learning, skill, curiosity.'
  },
  {
    id: 'career',
    name: 'Career',
    color: '#ff8e6e',
    blurb: 'Work, focus, direction.'
  }
];

export const AREA_BY_ID = Object.fromEntries(AREAS.map((a) => [a.id, a]));

// The 10 global habits you want to track.
// `target` would matter for weekly quotas; for now these are daily toggles.
export const GLOBAL_HABITS = [
  { id: 'h_sleep', name: 'Sleep 7+', note: '7+ hours of sleep' },
  { id: 'h_regulation', name: 'Regulation', note: 'Emotions in check' },
  { id: 'h_exercise', name: 'Exercise', note: 'Move the body' },
  { id: 'h_fasting', name: 'Fasting', note: 'Honour the window' },
  { id: 'h_no_alcohol', name: 'No Alcohol', note: 'Clear and steady' },
  { id: 'h_hydration', name: 'Hydration', note: 'Water through the day' },
  { id: 'h_learning', name: 'Learning', note: 'One thing learned' },
  { id: 'h_meditation', name: 'Meditation', note: 'Sit, even briefly' },
  { id: 'h_no_social', name: 'No Social Media', note: 'Out of the feed' },
  { id: 'h_one_task', name: '1 Task', note: 'One meaningful task' }
];

export const HABIT_BY_ID = Object.fromEntries(
  GLOBAL_HABITS.map((h) => [h.id, h])
);

// Single accent for the global "Habits" view. A muted jade reads warm
// against the near-black surface without competing with the area accents.
export const HABIT_ACCENT = '#7ec8a3';

export const MOODS = [
  { id: 1, label: 'Low', emoji: '🌧️' },
  { id: 2, label: 'Meh', emoji: '☁️' },
  { id: 3, label: 'Okay', emoji: '🌤️' },
  { id: 4, label: 'Good', emoji: '🌞' },
  { id: 5, label: 'Great', emoji: '✨' }
];

export const TASK_STATUS = [
  { id: 'todo', label: 'To Do', color: '#888888', short: 'todo' },
  { id: 'in_progress', label: 'In Progress', color: '#88b4ff', short: 'wip' },
  { id: 'done', label: 'Done', color: '#7fff9f', short: 'done' },
  { id: 'rejected', label: 'Rejected', color: '#ff6b6b', short: 'rej' }
];

export const TASK_STATUS_BY_ID = Object.fromEntries(
  TASK_STATUS.map((s) => [s.id, s])
);

// Map of Consciousness (David Hawkins). 17 levels on a logarithmic scale.
// `band` groups them into Lower / Middle / Upper for visual rhythm in the picker.
export const HAWKINS_LEVELS = [
  { value: 20,  name: 'Shame',         band: 'lower', color: '#3d1f1f' },
  { value: 30,  name: 'Guilt',         band: 'lower', color: '#5a2828' },
  { value: 50,  name: 'Apathy',        band: 'lower', color: '#7a4a2a' },
  { value: 75,  name: 'Grief',         band: 'lower', color: '#8a5a30' },
  { value: 100, name: 'Fear',          band: 'lower', color: '#a06030' },
  { value: 125, name: 'Desire',        band: 'lower', color: '#c07030' },
  { value: 150, name: 'Anger',         band: 'lower', color: '#d04545' },
  { value: 175, name: 'Pride',         band: 'lower', color: '#c8a030' },
  { value: 200, name: 'Courage',       band: 'middle', color: '#a0b040' },
  { value: 250, name: 'Neutrality',    band: 'middle', color: '#5fa050' },
  { value: 310, name: 'Willingness',   band: 'middle', color: '#3fb09a' },
  { value: 350, name: 'Acceptance',    band: 'upper', color: '#4ab0d0' },
  { value: 400, name: 'Reason',        band: 'upper', color: '#5a90e0' },
  { value: 500, name: 'Love',          band: 'upper', color: '#7aafee' },
  { value: 540, name: 'Joy',           band: 'upper', color: '#a0d0f0' },
  { value: 600, name: 'Peace',         band: 'upper', color: '#d8e8f0' },
  { value: 700, name: 'Enlightenment', band: 'upper', color: '#ffffff' }
];

export const HAWKINS_BY_VALUE = Object.fromEntries(
  HAWKINS_LEVELS.map((l) => [l.value, l])
);

export const HAWKINS_BANDS = [
  { id: 'lower', label: 'Lower' },
  { id: 'middle', label: 'Middle' },
  { id: 'upper', label: 'Upper' }
];
