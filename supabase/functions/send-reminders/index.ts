import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// Channel priority: ntfy, then Telegram, then WhatsApp (needs an approved template).
async function send(p: any, left: string[]): Promise<{ ok: boolean; via: string; err?: string }> {
  if (p.ntfy_enabled && p.ntfy_topic) {
    const r = await fetch(`https://ntfy.sh/${encodeURIComponent(p.ntfy_topic)}`, {
      method: 'POST', headers: { Title: 'Daily 3 reminder', Tags: 'memo' },
      body: `Still to do today:\n${left.map((t) => '• ' + t).join('\n')}`,
    });
    return r.ok ? { ok: true, via: 'ntfy' } : { ok: false, via: 'ntfy', err: `ntfy ${r.status}: ${await r.text()}` };
  }
  if (p.telegram_enabled && p.telegram_chat_id) {
    const text = `📝 Daily 3 reminder\nStill to do today:\n${left.map((t) => '• ' + t).join('\n')}`;
    const r = await fetch(`https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: p.telegram_chat_id, text }),
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
    if (hhmm < p.remind_time) { log.push(`too early (${hhmm} < ${p.remind_time})`); continue; }
    if (p.last_sent_date === date) { log.push('already sent today'); continue; }

    const { data: day } = await db.from('days').select('tasks').eq('user_id', p.user_id).eq('date', date).maybeSingle();
    const tasks = day?.tasks ?? p.defaults.map((name: string) => ({ name, done: false })); // app not opened today = nothing done
    const left = tasks.filter((t: any) => !t.done).map((t: any) => String(t.name).replace(/\s+/g, ' '));
    if (!left.length) { log.push('all done, no reminder'); continue; }
    if (dry) { log.push(`would send: ${left.join(', ')}`); continue; }

    // Claim today's slot BEFORE sending so overlapping runs cannot double-send.
    const { data: claimed } = await db.from('profiles').update({ last_sent_date: date })
      .eq('user_id', p.user_id).or(`last_sent_date.is.null,last_sent_date.neq.${date}`).select('user_id');
    if (!claimed?.length) { log.push('claimed by another run'); continue; }

    const res = await send(p, left);
    if (res.ok) log.push(`sent via ${res.via}: ${left.join(', ')}`);
    else { // failed: release the slot so the next run retries
      await db.from('profiles').update({ last_sent_date: p.last_sent_date }).eq('user_id', p.user_id);
      log.push(res.err!);
    }
  }
  return new Response(JSON.stringify(log, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
