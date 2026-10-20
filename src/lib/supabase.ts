import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
if (!url || !key) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 10 } },
});

// Calls a server function in /api with the signed-in user's token.
export async function callApi<T = unknown>(name: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const r = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Request failed (${r.status})`);
  return j as T;
}

export function friendlyError(e: unknown): string {
  const m = (e as { message?: string })?.message || String(e);
  if (m.includes('photo_required')) return 'Add a photo before marking this done.';
  if (m.includes('row-level security')) return 'You do not have permission to change this.';
  if (m.includes('Failed to fetch') || m.includes('NetworkError')) return 'No connection.';
  return m.replace(/^.*?ERROR:\s*/, '');
}
