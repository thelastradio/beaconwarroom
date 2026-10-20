import { useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase';
import { submit, shrinkPhoto, uid } from '../lib/offline';
import { useEv, useNow, toast } from '../lib/eventCtx';
import { isOverdue } from '../lib/rag';
import { fmtAgo, fmtWhen } from '../lib/time';
import { PHASE_LABEL, STATUS_LABEL, type Item, type ItemStatus, type ItemUpdate } from '../lib/types';
import { PhotoField, Sheet, StatusChip, StoredPhoto } from './ui';

const ORDER: ItemStatus[] = ['not_started', 'in_progress', 'done', 'blocked', 'na'];

function groupItems(items: Item[], now: number) {
  const g: { key: string; label: string; items: Item[] }[] = [
    { key: 'late', label: 'Overdue', items: [] },
    { key: 'soon', label: 'Next 2 hours', items: [] },
    { key: 'later', label: 'Later', items: [] },
    { key: 'none', label: 'No due time', items: [] },
    { key: 'closed', label: 'Done or not needed', items: [] },
  ];
  for (const i of items) {
    if (i.status === 'done' || i.status === 'na') g[4].items.push(i);
    else if (!i.due_at) g[3].items.push(i);
    else if (isOverdue(i, now)) g[0].items.push(i);
    else if (Date.parse(i.due_at) - now <= 2 * 3600e3) g[1].items.push(i);
    else g[2].items.push(i);
  }
  g[4].items.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  return g.filter((x) => x.items.length);
}

export function ItemList({ items, emptyText }: { items: Item[]; emptyText: string }) {
  const ev = useEv();
  const now = useNow();
  const [open, setOpen] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const groups = useMemo(() => groupItems(items, now), [items, now]);
  const tz = ev.event!.timezone;
  const current = items.find((i) => i.id === open) || null;

  if (!items.length) return <p className="muted">{emptyText}</p>;
  return (
    <div>
      {groups.map((g) => (
        <section className="group" key={g.key}>
          <h3>{g.label} ({g.items.length})</h3>
          {g.key === 'closed' && !showClosed ? (
            <button className="btn sm" onClick={() => setShowClosed(true)}>Show {g.items.length} closed items</button>
          ) : g.items.map((i) => (
            <button key={i.id} className={`item st-${i.status} ${isOverdue(i, now) ? 'late' : ''}`} onClick={() => setOpen(i.id)}>
              <span className="when">{i.due_at ? fmtWhen(i.due_at, tz, now) : '—'}</span>
              <span>
                <span className="t">{i.title}</span>
                <span className="tags">
                  {i.critical && <span className="tag crit">Critical</span>}
                  {i.photo_required && <span className="tag">Photo</span>}
                  {i.source === 'compliance' && <span className="tag">Compliance</span>}
                  {i.last_note && <span className="tag" title={i.last_note}>Note</span>}
                </span>
              </span>
              <StatusChip s={i.status} />
            </button>
          ))}
        </section>
      ))}
      {current && <ItemSheet item={current} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function ItemSheet({ item, onClose }: { item: Item; onClose: () => void }) {
  const ev = useEv();
  const canEdit = ev.me.canControl || (ev.me.role === 'poc' && ev.me.dept === item.dept_key);
  const [status, setStatus] = useState<ItemStatus>(item.status);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [history, setHistory] = useState<ItemUpdate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tz = ev.event!.timezone;
  const needsPhoto = status === 'done' && item.photo_required;

  useEffect(() => {
    supabase.from('item_updates').select('*').eq('item_id', item.id).order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setHistory((data as ItemUpdate[]) || []));
  }, [item.id, item.updated_at]);

  const save = async () => {
    setError(null);
    if (needsPhoto && !photo) return setError('This item needs a photo before it can be marked done.');
    if (status === 'blocked' && !note.trim()) return setError('Say what is blocking it, so the war room can help.');
    if (status === item.status && !note.trim() && !photo) return onClose();
    setBusy(true);
    try {
      const small = photo ? await shrinkPhoto(photo) : undefined;
      const r = await submit({
        id: uid(), kind: 'item_update', event_id: item.event_id, item_id: item.id, status, note: note.trim() || null,
        photo: small, client_at: new Date().toISOString(), label: `${item.title} → ${STATUS_LABEL[status]}`,
      });
      toast(r === 'queued' ? 'No signal. Saved on this phone; it will send when signal returns.' : `Saved: ${STATUS_LABEL[status]}`);
      await ev.reload();
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={item.title} onClose={onClose}>
      <div className="small muted">
        {ev.deptName(item.dept_key)} · {PHASE_LABEL[item.phase]} · Due {fmtWhen(item.due_at, tz)}
      </div>
      <div className="tags">
        {item.critical && <span className="tag crit">Critical</span>}
        {item.photo_required && <span className="tag">Photo required to finish</span>}
      </div>
      {item.details && <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{item.details}</p>}
      {canEdit ? (
        <>
          <div className="statuses" role="group" aria-label="Status">
            {ORDER.map((s) => (
              <button key={s} className={`s-${s}`} aria-pressed={status === s} onClick={() => setStatus(s)}>{STATUS_LABEL[s]}</button>
            ))}
          </div>
          <label className="f">Note {status === 'blocked' ? '(required)' : '(optional)'}
            <textarea className="in" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <PhotoField value={photo} onChange={setPhoto} required={needsPhoto} />
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save update'}</button>
        </>
      ) : (
        <div className="row"><span className="muted">Status</span><StatusChip s={item.status} /></div>
      )}
      <h3>History</h3>
      {history === null ? <p className="muted">Loading…</p> : history.length === 0 ? <p className="muted">No updates yet.</p> : (
        <div className="history">
          {history.map((h) => (
            <div key={h.id}>
              <div className="row"><StatusChip s={h.status} /><span className="small">{ev.personName(h.created_by)}</span>
                <span className="small muted">{fmtWhen(h.client_at || h.created_at, tz)} ({fmtAgo(h.created_at)})</span></div>
              {h.client_at && Date.parse(h.created_at) - Date.parse(h.client_at) > 120000 && (
                <div className="small muted">Made offline, synced {fmtWhen(h.created_at, tz)}{h.applied ? '' : '. Not applied: a newer update already existed.'}</div>
              )}
              {h.note && <div style={{ whiteSpace: 'pre-wrap' }}>{h.note}</div>}
              {h.photo_path && <StoredPhoto path={h.photo_path} />}
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
