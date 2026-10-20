import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase, friendlyError } from '../lib/supabase';
import { useEv, useNow, toast } from '../lib/eventCtx';
import { deptRag, progress, ragReason } from '../lib/rag';
import { localToIso } from '../lib/time';
import { ItemList } from '../components/Items';
import { IncidentRow, IncidentSheet } from '../components/Incidents';
import type { Incident, Phase } from '../lib/types';
import { DateTime } from 'luxon';

export default function DeptPage({ mine }: { mine?: boolean }) {
  const ev = useEv();
  const params = useParams();
  const now = useNow();
  const key = mine ? ev.me.dept! : params.deptKey!;
  const [adding, setAdding] = useState(false);
  const [openInc, setOpenInc] = useState<Incident | null>(null);
  const items = ev.items.filter((i) => i.dept_key === key);
  const incs = ev.incidents.filter((x) => x.dept_key === key && x.status === 'open');
  const rag = deptRag(items, incs, now);
  const p = progress(items);
  const poc = ev.members.find((m) => m.role === 'poc' && m.dept_key === key);
  const enabled = ev.enabledDepts.some((d) => d.key === key);
  const canEdit = ev.me.canControl || (ev.me.role === 'poc' && ev.me.dept === key);

  return (
    <main className="page stack">
      <div className="row">
        {!mine && <Link to="../wall" className="btn sm ghost" style={{ textDecoration: 'none' }}>War room</Link>}
        <h1 className="grow">{ev.deptName(key)}</h1>
        <span className={`chip ${rag === 'red' ? 'blocked' : rag === 'amber' ? 'not_started' : 'done'}`} style={rag === 'amber' ? { background: 'var(--amber)', color: 'var(--on-status)', border: 0 } : undefined}>
          {rag === 'red' ? 'Red' : rag === 'amber' ? 'Amber' : 'Green'}
        </span>
      </div>
      <div className="muted">{p.done} of {p.total} done · {ragReason(items, incs, now)} · POC: {poc ? ev.personName(poc.user_id) : 'not assigned'}</div>
      {!enabled && <div className="note">This department is switched off for this event.</div>}
      {!canEdit && <div className="small muted">View only. {ev.me.role === 'viewer' ? '' : 'Only this department’s POC or the Event Controller can update these items.'}</div>}
      {incs.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <h3>Open incidents</h3>
          {incs.map((x) => <IncidentRow key={x.id} inc={x} onOpen={() => setOpenInc(x)} />)}
        </section>
      )}
      {ev.me.canControl && (adding ? <AddItem dept={key} onDone={() => setAdding(false)} /> : <div><button className="btn sm" onClick={() => setAdding(true)}>Add item</button></div>)}
      <ItemList items={items} emptyText="No items in this department." />
      {openInc && <IncidentSheet inc={ev.incidents.find((x) => x.id === openInc.id) || openInc} onClose={() => setOpenInc(null)} />}
    </main>
  );
}

function AddItem({ dept, onDone }: { dept: string; onDone: () => void }) {
  const ev = useEv();
  const tz = ev.event!.timezone;
  const start = DateTime.fromISO(ev.event!.starts_at).setZone(tz);
  const [f, setF] = useState({ title: '', date: start.toISODate()!, time: start.minus({ hours: 1 }).toFormat('HH:mm'), phase: 'live' as Phase, critical: false, photo: false, details: '' });
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from('items').insert({
      event_id: ev.event!.id, dept_key: dept, title: f.title.trim(), details: f.details.trim(), phase: f.phase,
      due_at: localToIso(f.date, f.time, tz), critical: f.critical, photo_required: f.photo, source: 'manual',
    });
    setBusy(false);
    if (error) return toast(friendlyError(error));
    toast('Item added'); ev.reload(); onDone();
  };
  return (
    <form className="card stack" onSubmit={save}>
      <label className="f">Item<input className="in" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <div className="row">
        <label className="f grow">Due date<input className="in" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="f grow">Due time ({tz})<input className="in" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></label>
      </div>
      <label className="f">Phase
        <select className="in" value={f.phase} onChange={(e) => setF({ ...f, phase: e.target.value as Phase })}>
          <option value="planning">Planning</option><option value="build">Build and load-in</option><option value="live">Doors and live show</option>
          <option value="breakdown">Breakdown and load-out</option><option value="debrief">Debrief</option>
        </select>
      </label>
      <label className="f">Details<textarea className="in" value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={f.critical} onChange={(e) => setF({ ...f, critical: e.target.checked })} />Critical</label>
      <label className="check"><input type="checkbox" checked={f.photo} onChange={(e) => setF({ ...f, photo: e.target.checked })} />Photo required to finish</label>
      <div className="row"><button className="btn primary" disabled={busy}>Add item</button><button type="button" className="btn ghost" onClick={onDone}>Cancel</button></div>
    </form>
  );
}
