// Queue for updates made without signal. Each entry is sent in order when the connection returns.
import { get, set } from 'idb-keyval';
import { supabase } from './supabase';
import type { ItemStatus } from './types';

export type QueuedOp =
  | { id: string; kind: 'item_update'; event_id: string; item_id: string; status: ItemStatus; note: string | null; photo?: Blob; client_at: string; label: string }
  | { id: string; kind: 'incident'; event_id: string; level: number; dept_key: string; location: string; title: string; description: string; photo?: Blob; client_at: string; label: string };

export interface FailedOp { id: string; label: string; reason: string; at: string }

const QKEY = 'bwr-queue';
const FKEY = 'bwr-failed';
const listeners = new Set<() => void>();
export const onQueueChange = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach((f) => f());

export async function queued(): Promise<QueuedOp[]> { return (await get(QKEY)) || []; }
export async function failed(): Promise<FailedOp[]> { return (await get(FKEY)) || []; }
export async function clearFailed() { await set(FKEY, []); notify(); }

export function uid(): string {
  return (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

export async function enqueue(op: QueuedOp) {
  const q = await queued(); q.push(op); await set(QKEY, q); notify();
}

function isNetworkError(e: unknown): boolean {
  const m = String((e as { message?: string })?.message || e);
  return !navigator.onLine || /Failed to fetch|NetworkError|Load failed|network|timeout/i.test(m);
}

export async function shrinkPhoto(file: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.8));
  } catch {
    return file;
  }
}

export async function uploadPhoto(eventId: string, photo: Blob): Promise<string> {
  const path = `${eventId}/${uid()}.jpg`;
  const { error } = await supabase.storage.from('proofs').upload(path, photo, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

async function send(op: QueuedOp) {
  const photo_path = op.photo ? await uploadPhoto(op.event_id, op.photo) : null;
  const { data: s } = await supabase.auth.getSession();
  const me = s.session?.user.id;
  if (op.kind === 'item_update') {
    const { error } = await supabase.from('item_updates').insert({
      item_id: op.item_id, event_id: op.event_id, status: op.status, note: op.note, photo_path, client_at: op.client_at, created_by: me,
    });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('incidents').insert({
      event_id: op.event_id, level: op.level, dept_key: op.dept_key, location: op.location, title: op.title,
      description: op.description, photo_path, raised_by: me, raised_at: op.client_at,
    });
    if (error) throw error;
  }
}

// Try now; if there is no signal keep it in the queue. Returns 'sent' | 'queued'. Throws on a real refusal.
export async function submit(op: QueuedOp): Promise<'sent' | 'queued'> {
  if (!navigator.onLine) { await enqueue(op); return 'queued'; }
  try {
    await send(op);
    return 'sent';
  } catch (e) {
    if (isNetworkError(e)) { await enqueue(op); return 'queued'; }
    throw e;
  }
}

let flushing = false;
export async function flush(): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    let q = await queued();
    while (q.length) {
      const op = q[0];
      try {
        await send(op);
        sent++;
      } catch (e) {
        if (isNetworkError(e)) break;
        const f = await failed();
        f.unshift({ id: op.id, label: op.label, reason: String((e as { message?: string })?.message || e), at: new Date().toISOString() });
        await set(FKEY, f.slice(0, 50));
      }
      q = (await queued()).filter((x) => x.id !== op.id);
      await set(QKEY, q);
      notify();
    }
  } finally {
    flushing = false;
  }
  return sent;
}
