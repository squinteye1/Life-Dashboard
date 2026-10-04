// Weight tracking: unit conversion and series maths.
//
// Storage is always kg. The display unit is a setting only, so switching
// between kg and stones/lbs never rewrites history.

export const KG_PER_LB = 0.45359237;
export const LB_PER_STONE = 14;

// The unit a user gets before they choose one. Stones and pounds, because
// that is what this app was asked for; kg stays one tap away. Change this
// single constant to flip the default everywhere.
export const DEFAULT_WEIGHT_UNIT = 'stlb';

export const WEIGHT_UNITS = [
  { id: 'stlb', label: 'st · lb' },
  { id: 'kg', label: 'kg' }
];

// Coerce anything unrecognised (null, undefined, a stale value) to a valid id.
export function normaliseWeightUnit(value) {
  return value === 'kg' || value === 'stlb' ? value : DEFAULT_WEIGHT_UNIT;
}

export function kgToLb(kg) {
  return kg / KG_PER_LB;
}

export function lbToKg(lb) {
  return lb * KG_PER_LB;
}

// Split a kg value into whole stones + remaining pounds (lb 0..13).
// Round the total pounds first, so the remainder can never come out as 14
// (which would need carrying into the next stone).
export function kgToStonesLbs(kg) {
  const totalLb = Math.round(kgToLb(kg));
  const st = Math.floor(totalLb / LB_PER_STONE);
  return { st, lb: totalLb - st * LB_PER_STONE };
}

export function stonesLbsToKg(st, lb) {
  return lbToKg(st * LB_PER_STONE + lb);
}

// A plausible adult weight in kg, used only to sanity-check typed input.
export const MIN_KG = 20;
export const MAX_KG = 400;

export function isPlausibleKg(kg) {
  return Number.isFinite(kg) && kg >= MIN_KG && kg <= MAX_KG;
}

// Human-readable weight in the chosen unit. Metric shows one decimal;
// imperial rounds to the nearest pound, since stones/lbs are coarse.
export function formatWeight(kg, unit) {
  if (kg == null || !Number.isFinite(kg)) return '—';
  if (unit === 'stlb') {
    const { st, lb } = kgToStonesLbs(kg);
    return `${st} st ${lb} lb`;
  }
  return `${kg.toFixed(1)} kg`;
}

// Signed change, e.g. "-1.4 kg" / "-2 lb".
export function formatDelta(kg, unit) {
  if (kg == null || !Number.isFinite(kg)) return '—';
  const sign = kg > 0 ? '+' : kg < 0 ? '−' : '';
  const abs = Math.abs(kg);
  if (unit === 'stlb') {
    const rounded = Math.round(kgToLb(abs));
    if (rounded === 0) return '0 lb';
    return `${sign}${rounded} lb`;
  }
  return `${sign}${abs.toFixed(1)} kg`;
}

// ---------------------------------------------------------------------------
// Series maths
// ---------------------------------------------------------------------------

// Readings as a chronological array of { key, kg }, oldest first.
export function weightSeries(weightData) {
  return Object.keys(weightData || {})
    .filter((k) => {
      const kg = weightData[k]?.kg;
      return isPlausibleKg(kg);
    })
    .sort()
    .map((key) => ({ key, kg: weightData[key].kg }));
}

// Trailing moving mean over a *calendar* window, not the last N readings.
// That distinction matters: if you skip a fortnight, "last 7 readings" could
// span three months and the mean would stop tracking your current weight.
// Averages only the readings actually present in the window, so a missed day
// or two does not drag the value down. `minPoints` guards the first few days,
// where the mean would otherwise rest on a single reading and look like a
// real trend.
export function rollingMean(series, window = 7, minPoints = 3) {
  const out = [];
  if (series.length < minPoints) return out;
  let start = 0;
  let sum = 0;
  for (let i = 0; i < series.length; i++) {
    const cutoff = shiftKey(series[i].key, -(window - 1));
    while (start <= i && series[start].key < cutoff) {
      sum -= series[start].kg;
      start++;
    }
    sum += series[i].kg;
    const count = i - start + 1;
    if (count >= minPoints) out.push({ key: series[i].key, mean: sum / count });
  }
  return out;
}

// Mean of every reading within the last `days` calendar days of `endKey`.
// Used for the week-over-week rate, so it is a real calendar window
// rather than "the last 7 readings".
export function meanWithin(series, endKey, days) {
  const end = new Date(endKey);
  const from = new Date(end);
  from.setDate(from.getDate() - (days - 1));
  const fromKey = keyFromDate(from);
  const inWindow = series.filter((p) => p.key >= fromKey && p.key <= endKey);
  if (inWindow.length === 0) return null;
  return inWindow.reduce((acc, p) => acc + p.kg, 0) / inWindow.length;
}

function keyFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

// Move a date key by a number of calendar days.
function shiftKey(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return keyFromDate(dt);
}

// Total change across the whole record. This, not the day-over-day delta, is
// the number that matters: day-over-day movement is mostly water.
export function totalChange(series) {
  if (series.length < 2) return null;
  return series[series.length - 1].kg - series[0].kg;
}

// Week-over-week rate: the mean of the 7 days up to the latest reading minus
// the mean of the 7 days before that. Anchored on the newest reading rather
// than on today, so the rate stays meaningful when you have not weighed in
// for a day or two. Null until there is enough history to be meaningful.
export function weeklyRate(series, days = 7) {
  if (series.length < 2) return null;
  const latest = series[series.length - 1];
  const recent = meanWithin(series, latest.key, days);
  const priorEnd = new Date(latest.key);
  priorEnd.setDate(priorEnd.getDate() - days);
  const prior = meanWithin(series, keyFromDate(priorEnd), days);
  if (recent == null || prior == null) return null;
  return recent - prior;
}
