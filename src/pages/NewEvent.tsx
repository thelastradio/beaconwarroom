import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, friendlyError } from '../lib/supabase';
import type { Department } from '../lib/types';
import { guessZone, isValidZone, localToIso, zoneList } from '../lib/time';

export default function NewEvent() {
  const nav = useNavigate();
  const [depts, setDepts] = useState<Department[]>([]);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [f, setF] = useState({
    name: '', country: '', city: '', venue: '', venue_type: 'licensed_venue', timezone: guessZone(),
    date: '', doors: '18:00', endDate: '', end: '22:00', capacity: '', ticketed: true, alcohol: false,
    food_stalls: false, special_effects: false, nationalities: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(zoneList, []);

  useEffect(() => {
    supabase.from('departments').select('*').order('sort').then(({ data }) => setDepts((data as Department[]) || []));
  }, []);
  // switch obviously unused departments off by default, owner can change
  useEffect(() => {
    setOff((o) => {
      const n = new Set(o);
      f.alcohol ? n.delete('bar') : n.add('bar');
      f.food_stalls ? n.delete('food') : n.add('food');
      return n;
    });
  }, [f.alcohol, f.food_stalls]);

  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isValidZone(f.timezone)) return setError('Pick a valid time zone, for example Europe/London.');
    const starts = localToIso(f.date, f.doors, f.timezone);
    const ends = localToIso(f.endDate || f.date, f.end, f.timezone);
    if (!starts || !ends) return setError('Check the dates and times.');
    if (Date.parse(ends) <= Date.parse(starts)) return setError('Show end must be after doors. For shows past midnight, set the end date to the next day.');
    setBusy(true);
    const { data, error } = await supabase.rpc('create_event', {
      p_name: f.name.trim(), p_country: f.country.trim(), p_city: f.city.trim(), p_venue: f.venue.trim(),
      p_venue_type: f.venue_type, p_timezone: f.timezone, p_starts_at: starts, p_ends_at: ends,
      p_capacity: f.capacity ? Number(f.capacity) : null, p_ticketed: f.ticketed, p_alcohol: f.alcohol,
      p_food_stalls: f.food_stalls, p_special_effects: f.special_effects,
      p_artist_nationalities: f.nationalities.split(',').map((s) => s.trim()).filter(Boolean),
      p_disabled_departments: [...off],
    });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    nav(`/e/${data}/compliance?start=1`);
  };

  return (
    <>
      <header className="top"><div className="row"><Link to="/" className="btn sm ghost" style={{ textDecoration: 'none' }}>Back</Link><div className="title">New event</div></div></header>
      <main className="page">
        <form className="stack" onSubmit={submit} style={{ maxWidth: 640 }}>
          <label className="f">Event name<input className="in" required value={f.name} onChange={(e) => set('name', e.target.value)} /></label>
          <div className="row">
            <label className="f grow">Country<input className="in" required value={f.country} onChange={(e) => set('country', e.target.value)} placeholder="United Kingdom" /></label>
            <label className="f grow">City<input className="in" required value={f.city} onChange={(e) => set('city', e.target.value)} placeholder="London" /></label>
          </div>
          <label className="f">Venue<input className="in" value={f.venue} onChange={(e) => set('venue', e.target.value)} /></label>
          <label className="f">Venue type
            <select className="in" value={f.venue_type} onChange={(e) => set('venue_type', e.target.value)}>
              <option value="licensed_venue">Licensed venue (theatre, auditorium, hall)</option>
              <option value="open_ground">Open ground or outdoor site</option>
              <option value="club">Club or bar</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="f">Time zone of the venue
            <input className="in" list="zones" required value={f.timezone} onChange={(e) => set('timezone', e.target.value)} />
            <datalist id="zones">{zones.map((z) => <option key={z} value={z} />)}</datalist>
          </label>
          <div className="row">
            <label className="f grow">Show date<input className="in" type="date" required value={f.date} onChange={(e) => set('date', e.target.value)} /></label>
            <label className="f grow">Doors<input className="in" type="time" required value={f.doors} onChange={(e) => set('doors', e.target.value)} /></label>
          </div>
          <div className="row">
            <label className="f grow">End date (if after midnight)<input className="in" type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></label>
            <label className="f grow">Show ends<input className="in" type="time" required value={f.end} onChange={(e) => set('end', e.target.value)} /></label>
          </div>
          <label className="f">Capacity<input className="in" type="number" min={1} value={f.capacity} onChange={(e) => set('capacity', e.target.value)} /></label>
          <fieldset className="card stack" style={{ margin: 0 }}>
            <legend className="small muted">These decide which rules the compliance research checks</legend>
            <label className="check"><input type="checkbox" checked={f.ticketed} onChange={(e) => set('ticketed', e.target.checked)} />Ticketed</label>
            <label className="check"><input type="checkbox" checked={f.alcohol} onChange={(e) => set('alcohol', e.target.checked)} />Alcohol served</label>
            <label className="check"><input type="checkbox" checked={f.food_stalls} onChange={(e) => set('food_stalls', e.target.checked)} />Food stalls</label>
            <label className="check"><input type="checkbox" checked={f.special_effects} onChange={(e) => set('special_effects', e.target.checked)} />Drones, pyro or lasers</label>
            <label className="f">Artists' nationalities, comma separated<input className="in" value={f.nationalities} onChange={(e) => set('nationalities', e.target.value)} placeholder="India, United Kingdom" /></label>
          </fieldset>
          <fieldset className="card" style={{ margin: 0 }}>
            <legend className="small muted">Departments for this event ({depts.length - off.size} on)</legend>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 4 }}>
              {depts.map((d) => (
                <label key={d.key} className="check">
                  <input type="checkbox" checked={!off.has(d.key)} disabled={d.key === 'control' || d.key === 'licensing'}
                    onChange={(e) => setOff((o) => { const n = new Set(o); e.target.checked ? n.delete(d.key) : n.add(d.key); return n; })} />
                  {d.name}
                </label>
              ))}
            </div>
          </fieldset>
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create event and start compliance research'}</button>
        </form>
      </main>
    </>
  );
}
