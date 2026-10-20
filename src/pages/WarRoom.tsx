import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, friendlyError } from '../lib/supabase';
import { useEv, useNow, toast } from '../lib/eventCtx';
import { deptRag, isOverdue, progress, ragReason } from '../lib/rag';
import { fmtTime, fmtWhen, untilLabel } from '../lib/time';
import { IncidentRow, IncidentSheet } from '../components/Incidents';
import { ItemSheet } from '../components/Items';
import type { Incident, Item } from '../lib/types';

export default function WarRoom() {
  const ev = useEv();
  const now = useNow(15000);
  const e = ev.event!;
  const [openInc, setOpenInc] = useState<Incident | null>(null);
  const [openItem, setOpenItem] = useState<Item | null>(null);

  const strips = useMemo(() => ev.enabledDepts.map((d) => {
    const items = ev.items.filter((i) => i.dept_key === d.key);
    const incs = ev.incidents.filter((x) => x.dept_key === d.key);
    const poc = ev.members.find((m) => m.role === 'poc' && m.dept_key === d.key);
    return { d, rag: deptRag(items, incs, now), why: ragReason(items, incs, now), p: progress(items), poc: poc ? ev.personName(poc.user_id) : 'No POC' };
  }), [ev, now]);

  const enabledKeys = new Set(ev.enabledDepts.map((d) => d.key));
  const liveItems = ev.items.filter((i) => enabledKeys.has(i.dept_key));
  const all = progress(liveItems);
  const overdue = liveItems.filter((i) => isOverdue(i, now)).sort((a, b) => Number(b.critical) - Number(a.critical) || Date.parse(a.due_at!) - Date.parse(b.due_at!));
  const blocked = liveItems.filter((i) => i.status === 'blocked');
  const openIncs = ev.incidents.filter((x) => x.status === 'open').sort((a, b) => a.level - b.level || Date.parse(b.raised_at) - Date.parse(a.raised_at));
  const reds = strips.filter((s) => s.rag === 'red').length;
  const doorsIn = Date.parse(e.starts_at) - now;

  return (
    <main className="page wide stack">
      <section className="row wallhead" style={{ alignItems: 'flex-end', gap: 24 }}>
        <div>
          <div className="small muted">{e.timezone}</div>
          <div className="clock">{fmtTime(new Date(now).toISOString(), e.timezone)}</div>
        </div>
        <div className="kpis grow">
          <div className="kpi"><b>{doorsIn > 0 ? untilLabel(e.starts_at, now).replace('in ', '') : Date.parse(e.ends_at) > now ? 'Live' : 'Ended'}</b><span>{doorsIn > 0 ? 'to doors' : `doors ${fmtWhen(e.starts_at, e.timezone, now)}`}</span></div>
          <div className="kpi"><b>{all.done}/{all.total}</b><span>items done</span></div>
          <div className="kpi"><b style={{ color: overdue.length ? 'var(--amber)' : undefined }}>{overdue.length}</b><span>overdue</span></div>
          <div className="kpi"><b style={{ color: blocked.length ? 'var(--red)' : undefined }}>{blocked.length}</b><span>blocked</span></div>
          <div className="kpi"><b style={{ color: openIncs.some((i) => i.level <= 2) ? 'var(--red)' : undefined }}>{openIncs.length}</b><span>open incidents</span></div>
          <div className="kpi"><b style={{ color: reds ? 'var(--red)' : 'var(--green)' }}>{reds}</b><span>departments red</span></div>
        </div>
      </section>

      <div className="wall">
        <section aria-label="Departments">
          <div className="bank">
            {strips.map(({ d, rag, why, p, poc }) => (
              <Link key={d.key} to={`../dept/${d.key}`} className={`strip ${rag}`} title={`${d.name}: ${why}. POC: ${poc}`}>
                <span className="fill" style={{ height: `${p.total ? (p.done / p.total) * 100 : 0}%` }} />
                <span className="edge" />
                <span className="count">{p.done}<small>/{p.total}</small></span>
                <span>
                  <span className="name" style={{ display: 'block' }}>{d.name}</span>
                  <span className="why" style={{ display: 'block' }}>{why}</span>
                  <span className="why" style={{ display: 'block', color: 'var(--muted)' }}>{poc}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <aside className="stack">
          <section className="stack" style={{ gap: 8 }}>
            <h2>Open incidents</h2>
            {openIncs.length === 0 ? <p className="muted">None open.</p> : openIncs.slice(0, 8).map((x) => (
              <IncidentRow key={x.id} inc={x} onOpen={() => setOpenInc(x)} flash={x.level === 1 && now - Date.parse(x.raised_at) < 120000} />
            ))}
            {openIncs.length > 8 && <Link to="../incidents">All {openIncs.length} open incidents</Link>}
          </section>
          {ev.me.canControl && <SendBroadcast />}
          <section className="stack" style={{ gap: 8 }}>
            <h2>Overdue and blocked</h2>
            {[...blocked, ...overdue.filter((i) => i.status !== 'blocked')].slice(0, 12).map((i) => (
              <button key={i.id} className={`item st-${i.status} late`} onClick={() => setOpenItem(i)} style={{ gridTemplateColumns: '84px minmax(0,1fr)' }}>
                <span className="when" style={{ fontSize: '0.95rem' }}>{fmtWhen(i.due_at, e.timezone, now)}</span>
                <span><span className="t">{i.title}</span><span className="small muted" style={{ display: 'block' }}>{ev.deptName(i.dept_key)}{i.status === 'blocked' ? ` · Blocked${i.last_note ? `: ${i.last_note}` : ''}` : ''}</span></span>
              </button>
            ))}
            {!blocked.length && !overdue.length && <p className="muted">Nothing overdue.</p>}
          </section>
        </aside>
      </div>
      {openInc && <IncidentSheet inc={ev.incidents.find((x) => x.id === openInc.id) || openInc} onClose={() => setOpenInc(null)} />}
      {openItem && <ItemSheet item={ev.items.find((x) => x.id === openItem.id) || openItem} onClose={() => setOpenItem(null)} />}
    </main>
  );
}

function SendBroadcast() {
  const ev = useEv();
  const [msg, setMsg] = useState('');
  const [dept, setDept] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from('broadcasts').insert({ event_id: ev.event!.id, dept_key: dept || null, message: msg.trim(), urgent, created_by: ev.me.id });
    setBusy(false);
    if (error) return toast(friendlyError(error));
    setMsg(''); setUrgent(false); toast('Broadcast sent'); ev.reload();
  };
  return (
    <form className="card stack" onSubmit={send} style={{ gap: 8 }}>
      <h3>Broadcast</h3>
      <textarea className="in" placeholder="Message to the team" value={msg} onChange={(e) => setMsg(e.target.value)} required style={{ minHeight: 60 }} />
      <div className="row">
        <select className="in grow" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Send to">
          <option value="">Everyone</option>
          {ev.enabledDepts.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />Urgent</label>
      </div>
      <button className="btn primary" disabled={busy || !msg.trim()}>Send broadcast</button>
    </form>
  );
}
