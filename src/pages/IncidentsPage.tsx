import { useState } from 'react';
import { useEv } from '../lib/eventCtx';
import { IncidentRow, IncidentSheet } from '../components/Incidents';
import type { Incident } from '../lib/types';

export default function IncidentsPage() {
  const ev = useEv();
  const [filter, setFilter] = useState<'open' | 'all' | 'mine'>('open');
  const [open, setOpen] = useState<Incident | null>(null);
  const list = ev.incidents
    .filter((x) => filter === 'all' || (filter === 'open' ? x.status === 'open' : x.dept_key === ev.me.dept))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1) || a.level - b.level || Date.parse(b.raised_at) - Date.parse(a.raised_at));
  return (
    <main className="page stack">
      <div className="row">
        <h1 className="grow">Incidents</h1>
        <div className="row" role="group" aria-label="Filter">
          <button className="btn sm" aria-pressed={filter === 'open'} onClick={() => setFilter('open')}>Open</button>
          {ev.me.dept && <button className="btn sm" aria-pressed={filter === 'mine'} onClick={() => setFilter('mine')}>My department</button>}
          <button className="btn sm" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
        </div>
      </div>
      {list.length === 0 ? <p className="muted">{filter === 'open' ? 'No open incidents.' : 'No incidents.'}</p> :
        <div className="stack" style={{ gap: 8 }}>{list.map((x) => <IncidentRow key={x.id} inc={x} onOpen={() => setOpen(x)} />)}</div>}
      {open && <IncidentSheet inc={ev.incidents.find((x) => x.id === open.id) || open} onClose={() => setOpen(null)} />}
    </main>
  );
}
