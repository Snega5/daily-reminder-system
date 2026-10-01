import { useEffect, useRef, useState } from 'react';
import { load, save, mergeRemote, toKey, fromKey, ensureDay, toggle, rename, doneCount, streak } from './lib';
import { supabase, syncUp, pullDown } from './supabase';
import Account from './Account';

const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const fmt = (k) => fromKey(k).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

export default function App() {
  const [today, setToday] = useState(toKey());
  const [s, setS] = useState(() => ensureDay(load(), toKey()));
  const [view, setView] = useState('home');
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [picked, setPicked] = useState(null);
  const [session, setSession] = useState(null);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, sess) => setSession(sess));
    return () => data.subscription.unsubscribe();
  }, []);
  const uid = session?.user?.id;
  const dirty = useRef(false);      // true = local edits not yet saved to the server
  const pushedAll = useRef(false);
  const [synced, setSynced] = useState(false);
  const edit = (fn) => { dirty.current = true; setS(fn); };
  const pull = async () => {
    if (!uid || dirty.current) return;
    const r = await pullDown(uid);
    if (r) { setS((x) => mergeRemote(x, r)); setSynced(true); }
  };
  // On sign-in and whenever the app comes back to the foreground: load the server copy first.
  useEffect(() => {
    if (!uid) { setSynced(false); return; }
    pull();
    const onVis = () => { if (document.visibilityState === 'visible') pull(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [uid]);
  // Push local changes (debounced), but only after the first successful pull.
  useEffect(() => {
    if (!uid || !synced) return;
    const id = setTimeout(async () => {
      const ok = await syncUp(uid, s, today, !pushedAll.current);
      if (ok) { pushedAll.current = true; dirty.current = false; }
    }, 800);
    return () => clearTimeout(id);
  }, [s, uid, today, synced]);

  useEffect(() => save(s), [s]);

  // Midnight handling: re-check the local date every 15s and whenever the tab becomes visible again.
  useEffect(() => {
    const tick = () => setToday(toKey());
    const id = setInterval(tick, 15000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, []);
  useEffect(() => setS((x) => ensureDay(x, today)), [today]);

  // Browser-notification reminder (works while the tab/app is open).
  useEffect(() => {
    const check = () => {
      const n = new Date();
      const hhmm = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
      const left = (s.days[today] || []).filter((t) => !t.done);
      if (s.settings.notify && 'Notification' in window && Notification.permission === 'granted'
          && hhmm >= s.settings.time && s.lastNotified !== today && s.days[today] && left.length) {
        new Notification('Daily 3 reminder', { body: 'Still to do: ' + left.map((t) => t.name).join(', ') });
        setS((x) => ({ ...x, lastNotified: today }));
      }
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [s, today]);

  const tasks = s.days[today];
  if (!tasks) return null;
  const done = doneCount(tasks);
  const pct = Math.round((done / 3) * 100);
  const setSetting = (patch) => edit((x) => ({ ...x, settings: { ...x.settings, ...patch } }));

  async function enableNotify(on) {
    if (on && 'Notification' in window && Notification.permission !== 'granted') {
      if ((await Notification.requestPermission()) !== 'granted') return alert('Notifications are blocked in your browser settings.');
    }
    if (on && !('Notification' in window)) return alert('This browser does not support notifications.');
    setSetting({ notify: on });
  }

  if (view === 'history') {
    const y = month.getFullYear(), m = month.getMonth();
    const cells = [...Array(month.getDay()).fill(null), ...Array(new Date(y, m + 1, 0).getDate()).fill(0).map((_, i) => toKey(new Date(y, m, i + 1)))];
    const sel = picked && s.days[picked];
    return (
      <main>
        <button className="link" onClick={() => setView('home')}>← Back</button>
        <section className="card">
          <div className="row">
            <button className="link" onClick={() => setMonth(new Date(y, m - 1, 1))}>‹</button>
            <h2>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
            <button className="link" onClick={() => setMonth(new Date(y, m + 1, 1))}>›</button>
          </div>
          <div className="grid">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <b key={i} className="dow">{d}</b>)}
            {cells.map((k, i) => {
              if (!k) return <span key={i} />;
              const c = s.days[k] ? doneCount(s.days[k]) : -1;
              return (
                <button key={k} disabled={k > today} className={`cell c${c} ${picked === k ? 'sel' : ''}`} onClick={() => setPicked(k)}>
                  {Number(k.slice(8))}
                </button>
              );
            })}
          </div>
          <p className="muted small">Darker pink = more tasks done. Grey = no record.</p>
        </section>
        {picked && (
          <section className="card">
            <h3>{fmt(picked)}</h3>
            {sel ? (<>
              <p className="muted">{doneCount(sel)}/3 completed · {Math.round((doneCount(sel) / 3) * 100)}%</p>
              {sel.map((t, i) => <p key={i} className={t.done ? 'hist done' : 'hist'}>{t.done ? '✅' : '⬜'} {t.name}</p>)}
            </>) : <p className="muted">No record for this day.</p>}
          </section>
        )}
      </main>
    );
  }

  return (
    <main>
      <header>
        <p className="muted">{fmt(today)}</p>
        <h1>{greet()}, Snega 🌸</h1>
      </header>

      <section className="card">
        {tasks.map((t, i) => (
          <label key={i} className="task">
            <input type="checkbox" checked={t.done} onChange={() => edit((x) => toggle(x, today, i))} />
            <input className={t.done ? 'name done' : 'name'} defaultValue={t.name} key={t.name}
              maxLength={60} aria-label={`Task ${i + 1} name`}
              onClick={(e) => e.preventDefault()}
              onBlur={(e) => edit((x) => rename(x, today, i, e.target.value))} />
          </label>
        ))}
        <div className="bar"><div style={{ width: pct + '%' }} /></div>
        <div className="row"><b>{done}/3 completed</b><span>{pct}%</span></div>
        <p className="muted">{done === 3 ? '🎉 All done for today!' : done === 0 ? 'Fresh start — you’ve got this.' : 'Nice, keep going!'}</p>
      </section>

      <section className="card row">
        <span>🔥 Current streak</span><b>{streak(s.days, today)} day{streak(s.days, today) === 1 ? '' : 's'}</b>
      </section>

      <button className="btn" onClick={() => { setPicked(today); setView('history'); }}>📅 History</button>

      <section className="card">
        <h3>Reminder</h3>
        <label className="row"><span>Browser notification</span>
          <input type="checkbox" checked={s.settings.notify} onChange={(e) => enableNotify(e.target.checked)} /></label>
        <label className="row"><span>Time</span>
          <input type="time" value={s.settings.time} onChange={(e) => setSetting({ time: e.target.value })} /></label>
        <p className="muted small">Browser notification: only while this page is open. Only lists unfinished tasks, once a day.</p>
        <Account session={session} settings={s.settings} setSetting={setSetting} />
      </section>
    </main>
  );
}