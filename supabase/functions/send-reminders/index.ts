import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const MAX_REMINDERS = 2; // per day in total: the first reminder + 1 follow-up (set 3 for two follow-ups, etc.)
const REPEAT_MIN = 60;   // send a follow-up if tasks are still unfinished this long after the last reminder
const SLACK_MIN = 5;     // the scheduler runs about every 30 min, so allow a little slack

// Channel priority: ntfy, then Telegram, then WhatsApp (needs an approved template).
async function send(p: any, left: string[], again: boolean): Promise<{ ok: boolean; via: string; err?: string }> {
  const title = again ? 'Daily 3 reminder (again)' : 'Daily 3 reminder';
  const lines = left.map((t) => '• ' + t).join('\n');
  if (p.ntfy_enabled && p.ntfy_topic) {
    const r = await fetch(`https://ntfy.sh/${encodeURIComponent(p.ntfy_topic)}`, {
      method: 'POST', headers: { Title: title, Tags: 'memo' }, body: `Still to do today:\n${lines}`,
    });
    return r.ok ? { ok: true, via: 'ntfy' } : { ok: false, via: 'ntfy', err: `ntfy ${r.status}: ${await r.text()}` };
  }
  if (p.telegram_enabled && p.telegram_chat_id) {
    const r = await fetch(`https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: p.telegram_chat_id, text: `📝 ${title}\nStill to do today:\n${lines}` }),
    });
    return r.ok ? { ok: true, via: 'telegram' } : { ok: false, via: 'telegram', err: `Telegram ${r.status}: ${await r.text()}` };
  }
  const r = await fetch(`https://graph.facebook.com/v21.0/${Deno.env.get('WA_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('WA_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: p.whatsapp_phone, type: 'template',
      template: { name: Deno.env.get('WA_TEMPLATE_NAME') ?? 'daily_task_reminder', language: { code: 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: left.join(', ') }] }] },
    }),
  });
  return r.ok ? { ok: true, via: 'whatsapp' } : { ok: false, via: 'whatsapp', err: `WhatsApp ${r.status}: ${await r.text()}` };
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('forbidden', { status: 403 });
  const dry = new URL(req.url).searchParams.get('dry') === '1'; // dry=1: report only, send nothing
  const { data: all } = await db.from('profiles').select('*').or('ntfy_enabled.eq.true,telegram_enabled.eq.true,whatsapp_enabled.eq.true');
  const profiles = (all ?? []).filter((p: any) => (p.ntfy_enabled && p.ntfy_topic) || (p.telegram_enabled && p.telegram_chat_id) || (p.whatsapp_enabled && p.whatsapp_phone));
  const log: string[] = [];

  for (const p of profiles) {
    const now = new Date();
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: p.timezone }).format(now); // YYYY-MM-DD
    const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: p.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    const count = p.last_sent_date === date ? (p.sent_count ?? 0) : 0; // reminders already sent today

    if (count === 0 && hhmm < p.remind_time) { log.push(`too early (${hhmm} < ${p.remind_time})`); continue; }
    if (count >= MAX_REMINDERS) { log.push(`already sent ${count} reminders today`); continue; }
    if (count > 0) {
      const mins = p.last_sent_at ? (now.getTime() - new Date(p.last_sent_at).getTime()) / 60000 : Infinity;
      if (mins < REPEAT_MIN - SLACK_MIN) { log.push(`follow-up in ~${Math.ceil(REPEAT_MIN - mins)} min if still unfinished`); continue; }
    }

    const { data: day } = await db.from('days').select('tasks').eq('user_id', p.user_id).eq('date', date).maybeSingle();
    const tasks = day?.tasks ?? p.defaults.map((name: string) => ({ name, done: false })); // app not opened today = nothing done
    const left = tasks.filter((t: any) => !t.done).map((t: any) => String(t.name).replace(/\s+/g, ' '));
    if (!left.length) { log.push('all done, no reminder'); continue; }
    if (dry) { log.push(`would send reminder #${count + 1}: ${left.join(', ')}`); continue; }

    // Claim the slot BEFORE sending (compare-and-swap on last_sent_at) so overlapping runs cannot double-send.
    const prev = { last_sent_date: p.last_sent_date, sent_count: p.sent_count ?? 0, last_sent_at: p.last_sent_at };
    let q = db.from('profiles').update({ last_sent_date: date, sent_count: count + 1, last_sent_at: now.toISOString() }).eq('user_id', p.user_id);
    q = p.last_sent_at ? q.eq('last_sent_at', p.last_sent_at) : q.is('last_sent_at', null);
    const { data: claimed } = await q.select('user_id');
    if (!claimed?.length) { log.push('claimed by another run'); continue; }

    const res = await send(p, left, count > 0);
    if (res.ok) log.push(`sent reminder #${count + 1} via ${res.via}: ${left.join(', ')}`);
    else { // failed: release the slot so the next run retries
      await db.from('profiles').update(prev).eq('user_id', p.user_id);
      log.push(res.err!);
    }
  }
  return new Response(JSON.stringify(log, null, 2), { headers: { 'Content-Type': 'application/json' } });
});