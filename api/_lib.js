// Shared helpers for server functions (Vercel Node runtime).
import { createClient } from '@supabase/supabase-js';

export function env(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing environment variable ${name}`);
  return v;
}

export function adminClient() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

// Returns { user, profile, admin } for the signed-in caller, or throws {status, message}.
export async function caller(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) throw { status: 401, message: 'Not signed in' };
  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw { status: 401, message: 'Session expired: sign in again' };
  const { data: profile } = await admin.from('profiles').select('*').eq('id', data.user.id).single();
  return { user: data.user, profile, admin };
}

export async function membership(admin, eventId, userId) {
  const { data } = await admin.from('event_members').select('role, dept_key')
    .eq('event_id', eventId).eq('user_id', userId).maybeSingle();
  return data;
}

export function handle(fn) {
  return async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
    try {
      await fn(req, res);
    } catch (e) {
      const status = e?.status || 500;
      if (status >= 500) console.error(e);
      send(res, status, { error: e?.message || 'Server error' });
    }
  };
}
