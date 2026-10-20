import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../App';
import type { EventRow, Member } from '../lib/types';
import { fmtWhen } from '../lib/time';

const ROLE: Record<string, string> = { controller: 'Event Controller', poc: 'POC', viewer: 'Viewer' };

export default function Events() {
  const { profile, session } = useAuth();
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [mine, setMine] = useState<Member[]>([]);
  const [depts, setDepts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [ev, m, d] = await Promise.all([
        supabase.from('events').select('*').order('starts_at', { ascending: true }),
        supabase.from('event_members').select('event_id,user_id,role,dept_key').eq('user_id', session.user.id),
        supabase.from('departments').select('key,name'),
      ]);
      if (ev.error) setError(ev.error.message);
      setEvents((ev.data as EventRow[]) || []);
      setMine((m.data as Member[]) || []);
      setDepts(Object.fromEntries(((d.data as { key: string; name: string }[]) || []).map((x) => [x.key, x.name])));
    })();
  }, [session.user.id]);

  const now = Date.now();
  const upcoming = (events || []).filter((e) => Date.parse(e.ends_at) > now - 3 * 864e5);
  const past = (events || []).filter((e) => Date.parse(e.ends_at) <= now - 3 * 864e5).reverse();

  const roleOf = (id: string) => {
    if (profile.is_owner) return 'Owner';
    const m = mine.find((x) => x.event_id === id);
    if (!m) return '';
    return m.role === 'poc' ? `POC: ${depts[m.dept_key || ''] || m.dept_key}` : ROLE[m.role];
  };

  const Row = ({ e }: { e: EventRow }) => (
    <Link to={`/e/${e.id}`} className="card" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div className="row"><h2 className="grow">{e.name}</h2><span className="small muted">{roleOf(e.id)}</span></div>
      <div className="muted">{[e.venue, e.city, e.country].filter(Boolean).join(', ')}</div>
      <div className="small">Doors {fmtWhen(e.starts_at, e.timezone)} ({e.timezone})</div>
    </Link>
  );

  return (
    <>
      <header className="top">
        <div className="row">
          <div className="title grow">Beacon War Room</div>
          <span className="small muted">{profile.full_name || profile.email}</span>
          <button className="btn sm ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>
      <main className="page stack">
        <div className="row">
          <h1 className="grow">Events</h1>
          {profile.is_owner && <Link className="btn primary" to="/new" style={{ textDecoration: 'none' }}>New event</Link>}
        </div>
        {error && <div className="err">{error}</div>}
        {events === null && <p className="muted">Loading…</p>}
        {events && events.length === 0 && (
          <p className="muted">{profile.is_owner ? 'No events yet. Create the first one.' : 'You have not been added to an event yet. Ask the event owner to add you.'}</p>
        )}
        {upcoming.map((e) => <Row key={e.id} e={e} />)}
        {past.length > 0 && <h3 className="muted" style={{ marginTop: 16 }}>Past events</h3>}
        {past.map((e) => <Row key={e.id} e={e} />)}
      </main>
    </>
  );
}
