import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null; // null = app still works offline/localStorage

// Push-only sync: this device is the source of truth; the server copy exists so the reminder job can read it.
export async function syncUp(uid, s, today, full) {
  const dates = full ? Object.keys(s.days) : [today];
  const { error: e1 } = await supabase.from('profiles').upsert({
    user_id: uid, defaults: s.defaults, remind_time: s.settings.time,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ntfy_topic: s.settings.topic || null, ntfy_enabled: !!s.settings.ntfy && !!s.settings.topic,
  });
  const { error: e2 } = await supabase.from('days').upsert(dates.map((date) => ({ user_id: uid, date, tasks: s.days[date] })));
  if (e1 || e2) console.error('sync failed', e1 || e2);
  return !(e1 || e2);
}

// Read this user's data back from the server (returns null on failure so we never overwrite server data with stale local data).
export async function pullDown(uid) {
  const [p, d] = await Promise.all([
    supabase.from('profiles').select('defaults,remind_time,ntfy_topic,ntfy_enabled').eq('user_id', uid).maybeSingle(),
    supabase.from('days').select('date,tasks').eq('user_id', uid),
  ]);
  if (p.error || d.error) { console.error('pull failed', p.error || d.error); return null; }
  return { profile: p.data, days: Object.fromEntries((d.data || []).map((r) => [r.date, r.tasks])) };
}