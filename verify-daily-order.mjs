// Temporary: assert the Daily page section order, so the journal stays
// directly under the check-in card.
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.jsx', 'utf8');
const start = app.indexOf('className={`daily-checkin-card');
const region = app.slice(start, start + 12000);

const markers = [
  ['check-in (vibe)', 'className={`daily-checkin-card'],
  ['journal', 'className="daily-journal-card"'],
  ['weight chart', '<WeightChart'],
  ['habits mini', 'className="daily-habits-mini"'],
  ['overdue', 'title="Overdue"'],
  ['today', 'title="Today"'],
  ['tomorrow', 'title={`Tomorrow'],
  ['this week', 'title="This week"'],
  ['empty state', 'className="daily-empty"']
];

const found = markers
  .map(([label, pat]) => ({ label, at: region.indexOf(pat) }))
  .filter((x) => x.at >= 0)
  .sort((a, b) => a.at - b.at);

let bad = 0;
const must = (c, m) => {
  console.log(`  ${c ? 'OK  ' : 'FAIL'}  ${m}`);
  if (!c) bad++;
};

console.log('Daily page section order:');
found.forEach((x, i) => console.log(`  ${i + 1}. ${x.label}`));

console.log('');
const at = (label) => found.find((f) => f.label === label)?.at ?? -1;
must(at('check-in (vibe)') >= 0, 'check-in card present');
must(at('journal') >= 0, 'journal card present');
must(at('journal') > at('check-in (vibe)'), 'journal comes directly AFTER the check-in card');
must(
  at('habits mini') > at('journal'),
  'habits mini after the journal'
);
must(at('overdue') > at('habits mini'), 'deadlines after the habits mini');
must(
  at('weight chart') > at('this week'),
  'weight chart is LAST, after every deadline section'
);
must(at('empty state') > at('this week'), 'empty state stays with the deadlines');

// Exactly one of each, so a move cannot leave a duplicate behind.
for (const [label, needle] of [
  ['journal', 'className="daily-journal-card"'],
  ['weight chart', '<WeightChart'],
  ['habits mini', 'className="daily-habits-mini"']
]) {
  const n = (app.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  must(n === 1, `exactly one ${label} in the markup (found ${n})`);
}

console.log('\nhabits mini routes to Habits, not Areas:');
const mini = app.slice(app.indexOf('className="daily-habits-mini"'), app.indexOf('className="daily-habits-mini"') + 200);
must(mini.includes('onOpenHabits'), 'habits mini calls onOpenHabits');
must(!mini.includes('onOpenTask'), 'habits mini no longer calls onOpenTask');
const dailySig = app.slice(app.indexOf('function DailyView({'), app.indexOf('function DailyView({') + 500);
must(dailySig.includes('onOpenHabits,'), 'DailyView accepts onOpenHabits');
const hIdx = app.indexOf("onOpenHabits={() => setView('habits')}");
must(hIdx >= 0, 'App passes setView("habits") for it');
const jIdx = app.indexOf('onOpenJournal={() => setView');
must(hIdx > 0 && jIdx > 0 && Math.abs(hIdx - jIdx) < 400,
  'handler sits alongside the other view handlers');

console.log(bad ? `\n${bad} failure(s)` : '\nDaily section order and habits routing verified');
process.exit(bad ? 1 : 0);
