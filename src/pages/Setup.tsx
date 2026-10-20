import { useNavigate } from 'react-router-dom';
import { supabase, friendlyError } from '../lib/supabase';
import { useEv, toast } from '../lib/eventCtx';
import { fmtWhen } from '../lib/time';

const VENUE: Record<string, string> = { licensed_venue: 'Licensed venue', open_ground: 'Open ground', club: 'Club or bar', other: 'Other' };

export default function Setup() {
  const ev = useEv();
  const nav = useNavigate();
  const e = ev.event!;
  const enabled = new Set(ev.enabledDepts.map((d) => d.key));

  const toggle = async (key: string, on: boolean) => {
    const { error } = await supabase.from('event_departments').update({ enabled: on }).eq('event_id', e.id).eq('dept_key', key);
    if (error) return toast(friendlyError(error));
    ev.reload();
  };
  const del = async () => {
    if (prompt(`This deletes the event and all its history. Type the event name to confirm:\n${e.name}`) !== e.name) return;
    const { error } = await supabase.from('events').delete().eq('id', e.id);
    if (error) return toast(friendlyError(error));
    nav('/');
  };

  return (
    <main className="page stack">
      <h1>Setup</h1>
      <section className="card stack" style={{ gap: 4 }}>
        <h2>Event</h2>
        <div>{[e.venue, e.city, e.country].filter(Boolean).join(', ')} ({VENUE[e.venue_type]})</div>
        <div className="muted">Doors {fmtWhen(e.starts_at, e.timezone)} · ends {fmtWhen(e.ends_at, e.timezone)} · {e.timezone}</div>
        <div className="muted">Capacity {e.capacity ?? 'not set'} · {e.ticketed ? 'ticketed' : 'free'} · alcohol {e.alcohol ? 'yes' : 'no'} · food stalls {e.food_stalls ? 'yes' : 'no'} · special effects {e.special_effects ? 'yes' : 'no'}</div>
        <div className="muted">Artists from: {e.artist_nationalities.join(', ') || 'not set'}</div>
      </section>
      <section className="card stack">
        <h2>Departments</h2>
        <p className="muted small">Switched-off departments disappear from the war room. Their items are kept.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 4 }}>
          {ev.departments.map((d) => (
            <label key={d.key} className="check">
              <input type="checkbox" checked={enabled.has(d.key)} disabled={d.key === 'control' || d.key === 'licensing'} onChange={(x) => toggle(d.key, x.target.checked)} />
              {d.name}
            </label>
          ))}
        </div>
      </section>
      {ev.me.isOwner && (
        <section className="card stack">
          <h2>Delete event</h2>
          <p className="muted small">Removes the event, every item, update, incident and photo record. This cannot be undone.</p>
          <div><button className="btn danger" onClick={del}>Delete event</button></div>
        </section>
      )}
    </main>
  );
}
