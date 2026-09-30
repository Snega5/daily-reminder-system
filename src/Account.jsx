import { useState } from 'react';
import { supabase } from './supabase';

export default function Account({ session, settings, setSetting }) {
  const [email, setEmail] = useState(''), [pw, setPw] = useState(''), [msg, setMsg] = useState('');
  if (!supabase) return <p className="muted small">Browser reminders only. Phone reminders need Supabase (see README).</p>;
  const auth = async (signUp) => {
    const creds = { email, password: pw };
    const { error } = signUp ? await supabase.auth.signUp(creds) : await supabase.auth.signInWithPassword(creds);
    setMsg(error ? error.message : '');
  };
  if (!session) return (
    <div className="stack">
      <p className="muted small">Sign in to sync and enable phone reminders.</p>
      <input className="txt" type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="txt" type="password" placeholder="password (6+ chars)" value={pw} onChange={(e) => setPw(e.target.value)} />
      <div className="row"><button className="btn" onClick={() => auth(false)}>Sign in</button><button className="btn" onClick={() => auth(true)}>Sign up</button></div>
      {msg && <p className="small">{msg}</p>}
    </div>
  );
  const gen = () => setSetting({ topic: 'daily3-' + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('') });
  const test = async () => {
    try {
      const r = await fetch(`https://ntfy.sh/${settings.topic}`, { method: 'POST', headers: { Title: 'Daily 3 test' }, body: 'It works! 🎉' });
      setMsg(r.ok ? 'Test sent — check your phone.' : 'Failed: ' + r.status);
    } catch { setMsg('Could not reach ntfy.sh'); }
  };
  return (
    <div className="stack">
      <label className="row"><span>Phone reminder (ntfy)</span>
        <input type="checkbox" checked={!!settings.ntfy} onChange={(e) => setSetting({ ntfy: e.target.checked })} /></label>
      <input className="txt" placeholder="Your private topic name" value={settings.topic || ''}
        onChange={(e) => setSetting({ topic: e.target.value.replace(/[^A-Za-z0-9_-]/g, '') })} />
      <div className="row"><button className="btn" onClick={gen}>Generate topic</button>
        <button className="btn" disabled={!settings.topic} onClick={test}>Send test</button></div>
      {msg && <p className="small">{msg}</p>}
      <p className="muted small">Subscribe to this exact topic in the ntfy app. Keep it secret. Signed in as {session.user.email}. <button className="link small" onClick={() => supabase.auth.signOut()}>Sign out</button></p>
    </div>
  );
}
