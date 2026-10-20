// POST /api/invite  { event_id, email, role: 'controller'|'poc'|'viewer', dept_key?, full_name? }
// Owner only. Creates the person's login if new (they are emailed a sign-in link and code) and gives them access to the event.
import { createClient } from '@supabase/supabase-js';
import { caller, env, handle, readBody, send } from './_lib.js';

const ROLES = ['controller', 'poc', 'viewer'];

export default handle(async (req, res) => {
  const { profile, user, admin } = await caller(req);
  if (!profile?.is_owner) throw { status: 403, message: 'Only the owner can add people' };

  const b = await readBody(req);
  const email = String(b.email || '').trim().toLowerCase();
  const role = String(b.role || '');
  const dept = role === 'poc' ? String(b.dept_key || '') : null;
  const name = String(b.full_name || '').trim();
  if (!b.event_id) throw { status: 400, message: 'event_id is required' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw { status: 400, message: 'Enter a valid email' };
  if (!ROLES.includes(role)) throw { status: 400, message: 'Pick a role' };
  if (role === 'poc' && !dept) throw { status: 400, message: 'Pick a department for the POC' };

  const { data: ev } = await admin.from('events').select('id').eq('id', b.event_id).maybeSingle();
  if (!ev) throw { status: 404, message: 'Event not found' };

  if (dept) {
    const { data: taken } = await admin.from('event_members').select('user_id, profiles:user_id(email)')
      .eq('event_id', b.event_id).eq('role', 'poc').eq('dept_key', dept).maybeSingle();
    if (taken) {
      const who = taken.profiles?.email || 'someone';
      if (who !== email) throw { status: 409, message: `This department already has a POC (${who}). Remove them first.` };
    }
  }

  let { data: existing } = await admin.from('profiles').select('id, email, full_name').eq('email', email).maybeSingle();
  let invited = false;
  if (!existing) {
    // Created already confirmed (sign-ups stay switched off), then emailed a sign-in link and code.
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name } });
    if (error) throw { status: 400, message: `Could not create the login: ${error.message}` };
    existing = { id: data.user.id, email, full_name: name };
    invited = true;
  } else if (name && !existing.full_name) {
    await admin.from('profiles').update({ full_name: name }).eq('id', existing.id);
  }

  const { error: mErr } = await admin.from('event_members').upsert(
    { event_id: b.event_id, user_id: existing.id, role, dept_key: dept, invited_by: user.id },
    { onConflict: 'event_id,user_id' },
  );
  if (mErr) throw { status: 400, message: mErr.message.includes('event_members_one_poc') ? 'This department already has a POC' : mErr.message };

  let mailError = null;
  if (invited) {
    const pub = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY', process.env.VITE_SUPABASE_ANON_KEY), { auth: { persistSession: false } });
    const { error: e } = await pub.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: env('SITE_URL') } });
    if (e) mailError = e.message;
  }
  send(res, 200, { ok: true, user_id: existing.id, invited, mailError });
});
