import { useEffect, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase';
import { submit, shrinkPhoto, uid } from '../lib/offline';
import { useEv, useNow, toast } from '../lib/eventCtx';
import { fmtAgo, fmtWhen } from '../lib/time';
import { LEVEL_LABEL, type Incident, type IncidentUpdate } from '../lib/types';
import { PhotoField, Sheet, StoredPhoto } from './ui';

const LEVEL_HELP: Record<number, string> = {
  1: 'Life safety or show stop: crowd crush risk, fire, medical emergency, structure failure',
  2: 'Safety risk or a stage stops: gate overflow, power loss, artist missing at call',
  3: 'Operational problem: scanner down, stall out of water, toilet blocked',
  4: 'For the record: lost item, guest complaint',
};

export function RaiseIncident({ onClose }: { onClose: () => void }) {
  const ev = useEv();
  const [level, setLevel] = useState(3);
  const [dept, setDept] = useState(ev.me.dept || 'control');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await submit({
        id: uid(), kind: 'incident', event_id: ev.event!.id, level, dept_key: dept, location: location.trim(),
        title: title.trim(), description: description.trim(), photo: photo ? await shrinkPhoto(photo) : undefined,
        client_at: new Date().toISOString(), label: `Incident: ${title.trim()}`,
      });
      toast(r === 'queued' ? 'No signal. Incident saved on this phone; it sends when signal returns. Use the radio for L1.' : `${LEVEL_LABEL[level]} raised`);
      await ev.reload();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Raise incident" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="stack" style={{ gap: 6 }} role="radiogroup" aria-label="Level">
          {[1, 2, 3, 4].map((l) => (
            <label key={l} className="check card" style={{ padding: 10, borderColor: level === l ? 'var(--text)' : undefined }}>
              <input type="radio" name="lvl" checked={level === l} onChange={() => setLevel(l)} />
              <span><span className={`lvl l${l}`}>{LEVEL_LABEL[l]}</span> <span className="small muted">{LEVEL_HELP[l]}</span></span>
            </label>
          ))}
        </div>
        <label className="f">What happened<input className="in" required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="f">Where (stage, gate, grid square)<input className="in" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
        <label className="f">Department responsible
          <select className="in" value={dept} onChange={(e) => setDept(e.target.value)}>
            {ev.enabledDepts.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
          </select>
        </label>
        <label className="f">Details<textarea className="in" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <PhotoField value={photo} onChange={setPhoto} />
        {level === 1 && <div className="note">For L1, also call it on the radio now. This alert is a record, not a replacement for the radio.</div>}
        {error && <div className="err" role="alert">{error}</div>}
        <button className="btn danger" disabled={busy || !title.trim()}>{busy ? 'Sending…' : `Raise ${LEVEL_LABEL[level]}`}</button>
      </form>
    </Sheet>
  );
}

export function canClose(ev: ReturnType<typeof useEv>, inc: Incident): boolean {
  if (ev.me.canControl) return true;
  return inc.level > 1 && ev.me.role === 'poc' && ev.me.dept === inc.dept_key;
}

export function IncidentSheet({ inc, onClose }: { inc: Incident; onClose: () => void }) {
  const ev = useEv();
  const tz = ev.event!.timezone;
  const [updates, setUpdates] = useState<IncidentUpdate[] | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAct = ev.me.canControl || ev.me.role === 'poc';
  const mayClose = canClose(ev, inc);

  const load = () => supabase.from('incident_updates').select('*').eq('incident_id', inc.id).order('created_at', { ascending: false })
    .then(({ data }) => setUpdates((data as IncidentUpdate[]) || []));
  useEffect(() => { load(); }, [inc.id, inc.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => PromiseLike<{ error: unknown }>, msg: string) => {
    setBusy(true); setError(null);
    const { error } = await fn();
    setBusy(false);
    if (error) return setError(friendlyError(error));
    setNote(''); toast(msg); load(); ev.reload();
  };

  return (
    <Sheet title={inc.title} onClose={onClose}>
      <div className="row"><span className={`lvl l${inc.level}`}>{LEVEL_LABEL[inc.level]}</span>
        <span className="small">{ev.deptName(inc.dept_key)}</span>
        <span className="small muted">{inc.status === 'open' ? 'Open' : `Closed by ${ev.personName(inc.closed_by)} ${fmtWhen(inc.closed_at, tz)}`}</span></div>
      <div className="small muted">Raised by {ev.personName(inc.raised_by)} at {fmtWhen(inc.raised_at, tz)}{inc.location ? `, ${inc.location}` : ''}</div>
      {inc.description && <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{inc.description}</p>}
      {inc.photo_path && <StoredPhoto path={inc.photo_path} />}
      {canAct && (
        <div className="stack">
          <label className="f">{inc.status === 'open' ? 'Add an update or closing note' : 'Note'}
            <textarea className="in" value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="row">
            <button className="btn" disabled={busy || !note.trim()} onClick={() => run(() =>
              supabase.from('incident_updates').insert({ incident_id: inc.id, event_id: inc.event_id, note: note.trim(), created_by: ev.me.id }), 'Update added')}>Add update</button>
            {inc.status === 'open' && mayClose && (
              <button className="btn primary" disabled={busy} onClick={() => run(() => supabase.rpc('close_incident', { p_id: inc.id, p_note: note.trim() }), 'Incident closed')}>Close incident</button>
            )}
            {inc.status === 'closed' && mayClose && (
              <button className="btn" disabled={busy} onClick={() => run(() => supabase.rpc('reopen_incident', { p_id: inc.id, p_note: note.trim() }), 'Incident reopened')}>Reopen</button>
            )}
          </div>
          {inc.status === 'open' && !mayClose && <p className="small muted">{inc.level === 1 ? 'Only the Event Controller can close an L1 incident.' : 'Only the Event Controller or this department’s POC can close it.'}</p>}
          {error && <div className="err" role="alert">{error}</div>}
        </div>
      )}
      <h3>Timeline</h3>
      {updates === null ? <p className="muted">Loading…</p> : updates.length === 0 ? <p className="muted">No updates yet.</p> : (
        <div className="history">
          {updates.map((u) => (
            <div key={u.id}><div className="small"><b>{ev.personName(u.created_by)}</b> <span className="muted">{fmtWhen(u.created_at, tz)} ({fmtAgo(u.created_at)})</span></div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{u.note}</div></div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

export function IncidentRow({ inc, onOpen, flash }: { inc: Incident; onOpen: () => void; flash?: boolean }) {
  const ev = useEv();
  const now = useNow();
  return (
    <button className={`inc ${inc.status} ${flash ? 'flash' : ''}`} onClick={onOpen}>
      <span className={`lvl l${inc.level}`}>L{inc.level}</span>
      <span>
        <span style={{ fontWeight: 600 }}>{inc.title}</span>
        <span className="small muted" style={{ display: 'block' }}>
          {ev.deptName(inc.dept_key)}{inc.location ? `, ${inc.location}` : ''} · {fmtAgo(inc.raised_at, now)}{inc.status === 'closed' ? ' · closed' : ''}
        </span>
      </span>
    </button>
  );
}
