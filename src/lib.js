// Pure logic (no React) so it can be tested with `npm test`.
const KEY = 'daily3-v1';
const pad = (n) => String(n).padStart(2, '0');
export const toKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // LOCAL date
export const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return toKey(d); };
export const DEFAULTS = ['Task 1', 'Task 2', 'Task 3'];

export const emptyState = () => ({ defaults: [...DEFAULTS], days: {}, settings: { time: '20:00', notify: false }, lastNotified: '' });

// Creates today's fresh unchecked list from the default names. Never touches older days.
export function ensureDay(s, key) {
  if (s.days[key]) return s;
  return { ...s, days: { ...s.days, [key]: s.defaults.map((name) => ({ name, done: false })) } };
}
export function toggle(s, key, i) {
  const t = s.days[key].map((x, j) => (j === i ? { ...x, done: !x.done } : x));
  return { ...s, days: { ...s.days, [key]: t } };
}
// Renaming changes today's task AND the default for future days; past days stay as they were.
export function rename(s, key, i, name) {
  const n = name.trim() || s.defaults[i];
  const t = s.days[key].map((x, j) => (j === i ? { ...x, name: n } : x));
  return { ...s, defaults: s.defaults.map((x, j) => (j === i ? n : x)), days: { ...s.days, [key]: t } };
}
export const doneCount = (t) => (t ? t.filter((x) => x.done).length : 0);
// Consecutive all-3-done days. If today isn't finished yet, the streak counts back from yesterday.
export function streak(days, today) {
  let k = doneCount(days[today]) === 3 ? today : addDays(today, -1);
  let n = 0;
  while (doneCount(days[k]) === 3) { n++; k = addDays(k, -1); }
  return n;
}
// Server data wins per date; dates that exist only locally are kept. Profile (names/time/topic) comes from the server if it exists.
export function mergeRemote(s, remote) {
  const next = { ...s, days: { ...s.days, ...remote.days } };
  const p = remote.profile;
  if (p) {
    next.defaults = p.defaults;
    next.settings = { ...s.settings, time: p.remind_time, topic: p.ntfy_topic || '', ntfy: !!p.ntfy_enabled };
  }
  return next;
}
export function load() {
  try {
    const r = JSON.parse(localStorage.getItem(KEY));
    if (r && r.days && Array.isArray(r.defaults)) return { ...emptyState(), ...r };
  } catch { /* fall through */ }
  return emptyState();
}
export const save = (s) => localStorage.setItem(KEY, JSON.stringify(s));