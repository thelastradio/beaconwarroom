import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import type { Profile } from './lib/types';
import Login from './pages/Login';
import Events from './pages/Events';
import NewEvent from './pages/NewEvent';
import EventShell from './pages/EventShell';

interface Auth { session: Session; profile: Profile; refreshProfile: () => Promise<void> }
const AuthCtx = createContext<Auth | null>(null);
export const useAuth = () => useContext(AuthCtx)!;

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const loadProfile = async (uid: string) => {
    const key = `bwr-profile-${uid}`;
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single();
    if (data) {
      try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* storage unavailable */ }
      setProfile(data as Profile);
      return;
    }
    // no signal: use the copy saved on this phone
    try { const c = localStorage.getItem(key); if (c) setProfile(JSON.parse(c)); } catch { /* storage unavailable */ }
  };
  useEffect(() => {
    if (session?.user.id) loadProfile(session.user.id); else setProfile(null);
  }, [session?.user.id]);

  if (session === undefined) return <div className="login"><p className="muted">Loading…</p></div>;
  if (!session) return <Login />;
  if (!profile) return <div className="login"><p className="muted">Loading your access…</p></div>;

  return (
    <AuthCtx.Provider value={{ session, profile, refreshProfile: () => loadProfile(session.user.id) }}>
      <Routes>
        <Route path="/" element={<Events />} />
        <Route path="/new" element={profile.is_owner ? <NewEvent /> : <Navigate to="/" />} />
        <Route path="/e/:eventId/*" element={<EventShell />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </AuthCtx.Provider>
  );
}
