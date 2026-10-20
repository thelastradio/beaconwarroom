// GET /api/keepalive — called once a day by the Vercel cron in vercel.json.
// Writes and reads the database so the free Supabase project counts as active and does not pause.
// Vercel sends "Authorization: Bearer <CRON_SECRET>" automatically when CRON_SECRET is set.
import { adminClient, send } from './_lib.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (!secret || auth !== `Bearer ${secret}`) return send(res, 401, { error: 'Unauthorized' });
  try {
    const admin = adminClient();
    const at = new Date().toISOString();
    const { error } = await admin.from('heartbeat')
      .upsert({ source: 'keepalive', at, detail: 'Vercel daily cron' }, { onConflict: 'source' });
    if (error) throw error;
    const { count, error: readError } = await admin.from('events').select('id', { count: 'exact', head: true });
    if (readError) throw readError;
    send(res, 200, { ok: true, at, events: count });
  } catch (e) {
    console.error('keepalive failed', e?.message || e);
    send(res, 500, { error: e?.message || 'Server error' });
  }
}
