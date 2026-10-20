import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useAuth } from '../App';
import { useEvent } from '../lib/useEvent';
import { EventCtx, registerToast, useNow } from '../lib/eventCtx';
import { failed, onQueueChange, queued, clearFailed, type FailedOp } from '../lib/offline';
import { fmtAgo } from '../lib/time';
import { RaiseIncident } from '../components/Incidents';
import WarRoom from './WarRoom';
import DeptPage from './DeptPage';
import IncidentsPage from './IncidentsPage';
import People from './People';
import Compliance from './Compliance';
import Setup from './Setup';

export default function EventShell() {
  const { eventId = '' } = useParams();
  const { session, profile } = useAuth();
  const ev = useEvent(eventId, session.user.id, profile.is_owner);
  const [toastMsg, setToast] = useState<string | null>(null);
  const [raise, setRaise] = useState(false);
  const [pending, setPending] = useState(0);
  const [fails, setFails] = useState<FailedOp[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const now = useNow(10000);

  useEffect(() => { registerToast(setToast); return () => registerToast(null); }, []);
  useEffect(() => {
    const upd = async () => { setPending((await queued()).length); setFails(await failed()); };
    upd();
    const off = onQueueChange(upd);
    const on = () => setOnline(true), offl = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', offl);
    return () => { off(); window.removeEventListener('online', on); window.removeEventListener('offline', offl); };
  }, []);

  const latest = useMemo(() => ev.broadcasts.find((b) => now - Date.parse(b.created_at) < 3 * 3600e3), [ev.broadcasts, now]);

  if (ev.loading) return <div className="login"><p className="muted">Loading event…</p></div>;
  if (ev.error || !ev.event) return (
    <div className="login"><div className="card"><h2>Event not available</h2>
      <p className="muted">{ev.error?.includes('0 rows') || !ev.event ? 'You do not have access to this event, or it was removed.' : ev.error}</p>
      <Link to="/" className="btn">All events</Link></div></div>
  );
  const role = ev.me.role;
  if (!role) return <Navigate to="/" />;
  const isPoc = role === 'poc';
  const canRaise = role !== 'viewer';
  const showCompliance = ev.me.canControl || (isPoc && ev.me.dept === 'licensing');
  const syncClass = !online ? 'off' : ev.live ? '' : 'poll';
  const syncText = !online ? 'Offline' : ev.live ? 'Live' : `Synced ${fmtAgo(new Date(ev.lastSync).toISOString(), now)}`;

  return (
    <EventCtx.Provider value={ev}>
      <header className="top">
        <div className="row">
          <Link to="/" className="btn sm ghost" style={{ textDecoration: 'none' }} aria-label="All events">Events</Link>
          <div className="title grow">{ev.event.name}</div>
          <span className={`sync ${syncClass}`} title="Live = instant updates. Otherwise the app refreshes every 20 seconds."><i />{syncText}</span>
          {pending > 0 && <span className="tag" title="Saved on this phone, sends when signal returns">{pending} waiting to send</span>}
          {canRaise && <button className="btn sm danger desk-only" onClick={() => setRaise(true)}>Raise incident</button>}
        </div>
        <nav className="tabs" aria-label="Sections">
          {isPoc && <NavLink to="mine" className={({ isActive }) => (isActive ? 'on' : '')}>My items</NavLink>}
          <NavLink to="wall" className={({ isActive }) => (isActive ? 'on' : '')}>War room</NavLink>
          <NavLink to="incidents" className={({ isActive }) => (isActive ? 'on' : '')}>Incidents</NavLink>
          {showCompliance && <NavLink to="compliance" className={({ isActive }) => (isActive ? 'on' : '')}>Compliance</NavLink>}
          {ev.me.isOwner && <NavLink to="people" className={({ isActive }) => (isActive ? 'on' : '')}>People</NavLink>}
          {ev.me.canControl && <NavLink to="setup" className={({ isActive }) => (isActive ? 'on' : '')}>Setup</NavLink>}
        </nav>
      </header>

      <div className="page wide" style={{ paddingBottom: 0 }}>
        {latest && (
          <div className={`bcast ${latest.urgent ? 'urgent' : ''}`} role="status">
            <div className="small muted">{latest.dept_key ? `To ${ev.deptName(latest.dept_key)}` : 'To everyone'} · {ev.personName(latest.created_by)} · {fmtAgo(latest.created_at, now)}</div>
            <div style={{ fontWeight: 600 }}>{latest.message}</div>
          </div>
        )}
        {fails.length > 0 && (
          <div className="err" style={{ marginTop: 8 }}>
            <b>{fails.length} offline update{fails.length > 1 ? 's were' : ' was'} refused when sent:</b>
            <ul style={{ margin: '6px 0' }}>{fails.slice(0, 5).map((f) => <li key={f.id}>{f.label}: {f.reason}</li>)}</ul>
            <button className="btn sm" onClick={() => clearFailed()}>Dismiss</button>
          </div>
        )}
      </div>

      <Routes>
        <Route index element={<Navigate to={isPoc ? 'mine' : 'wall'} replace />} />
        <Route path="mine" element={isPoc ? <DeptPage mine /> : <Navigate to="../wall" />} />
        <Route path="wall" element={<WarRoom />} />
        <Route path="dept/:deptKey" element={<DeptPage />} />
        <Route path="incidents" element={<IncidentsPage />} />
        <Route path="compliance" element={showCompliance ? <Compliance /> : <Navigate to="../wall" />} />
        <Route path="people" element={ev.me.isOwner ? <People /> : <Navigate to="../wall" />} />
        <Route path="setup" element={ev.me.canControl ? <Setup /> : <Navigate to="../wall" />} />
        <Route path="*" element={<Navigate to="wall" />} />
      </Routes>

      <nav className="bottom phone-only" aria-label="Quick actions">
        {isPoc && <NavLink to="mine" className={({ isActive }) => (isActive ? 'on' : '')}>My items</NavLink>}
        <NavLink to="wall" className={({ isActive }) => (isActive ? 'on' : '')}>War room</NavLink>
        <NavLink to="incidents" className={({ isActive }) => (isActive ? 'on' : '')}>Incidents</NavLink>
        {canRaise && <button className="raise" onClick={() => setRaise(true)}>Raise incident</button>}
      </nav>
      {raise && <RaiseIncident onClose={() => setRaise(false)} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </EventCtx.Provider>
  );
}
