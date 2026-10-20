import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';
import { flush } from './offline';
import type { Broadcast, Department, EventDept, EventRow, Incident, Item, Member, Profile, Role } from './types';

export interface EventData {
  event: EventRow | null;
  departments: Department[];
  eventDepts: EventDept[];
  members: Member[];
  people: Record<string, Profile>;
  items: Item[];
  incidents: Incident[];
  broadcasts: Broadcast[];
  loading: boolean;
  error: string | null;
  live: boolean; // realtime connected
  lastSync: number;
  reload: () => Promise<void>;
  me: { id: string; role: Role | 'owner' | null; dept: string | null; isOwner: boolean; canControl: boolean };
  enabledDepts: Department[];
  deptName: (k: string) => string;
  personName: (id: string | null) => string;
}

const POLL_MS = 20000;

export function useEvent(eventId: string, userId: string, isOwner: boolean): EventData {
  const [state, setState] = useState({
    event: null as EventRow | null, departments: [] as Department[], eventDepts: [] as EventDept[],
    members: [] as Member[], people: {} as Record<string, Profile>, items: [] as Item[],
    incidents: [] as Incident[], broadcasts: [] as Broadcast[], loading: true, error: null as string | null, lastSync: 0,
  });
  const [live, setLive] = useState(false);
  const busy = useRef(false);

  const reload = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      await flush().catch(() => 0);
      const [ev, depts, ed, mem, items, inc, bc] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('departments').select('*').order('sort'),
        supabase.from('event_departments').select('*').eq('event_id', eventId),
        supabase.from('event_members').select('event_id,user_id,role,dept_key').eq('event_id', eventId),
        supabase.from('items').select('*').eq('event_id', eventId).order('due_at', { ascending: true, nullsFirst: false }).limit(5000),
        supabase.from('incidents').select('*').eq('event_id', eventId).order('raised_at', { ascending: false }).limit(1000),
        supabase.from('broadcasts').select('*').eq('event_id', eventId).order('created_at', { ascending: false }).limit(50),
      ]);
      const err = ev.error || depts.error || ed.error || mem.error || items.error || inc.error || bc.error;
      if (err) throw err;
      const ids = new Set<string>((mem.data as Member[]).map((m) => m.user_id));
      (items.data as Item[]).forEach((i) => i.updated_by && ids.add(i.updated_by));
      (inc.data as Incident[]).forEach((i) => { ids.add(i.raised_by); if (i.closed_by) ids.add(i.closed_by); });
      const prof = ids.size ? await supabase.from('profiles').select('*').in('id', [...ids]) : { data: [] as Profile[] };
      const people: Record<string, Profile> = {};
      (prof.data as Profile[] | null)?.forEach((p) => { people[p.id] = p; });
      const next = {
        event: ev.data as EventRow, departments: depts.data as Department[], eventDepts: ed.data as EventDept[],
        members: mem.data as Member[], people, items: items.data as Item[], incidents: inc.data as Incident[],
        broadcasts: bc.data as Broadcast[], loading: false, error: null, lastSync: Date.now(),
      };
      setState(next);
      idbSet(`bwr-snap-${eventId}-${userId}`, next).catch(() => undefined);
    } catch (e) {
      // keep showing the last good data when a refresh fails (no signal); on a first load, fall back to the copy saved on this phone
      const msg = String((e as { message?: string })?.message || e);
      const code = (e as { code?: string })?.code;
      const accessGone = code === 'PGRST116' || /0 rows|JSON object requested|JWT|permission denied/i.test(msg);
      const snapKey = `bwr-snap-${eventId}-${userId}`;
      if (accessGone) {
        // access was removed or the event deleted: forget the saved copy and stop showing data
        idbDel(snapKey).catch(() => undefined);
        setState((s) => ({ ...s, event: null, items: [], incidents: [], broadcasts: [], loading: false, error: msg }));
        return;
      }
      const snap = await idbGet(snapKey).catch(() => undefined);
      setState((s) => (s.event ? { ...s, loading: false }
        : snap ? { ...snap, loading: false, error: null }
          : { ...s, loading: false, error: navigator.onLine ? msg : 'No connection and nothing saved on this phone yet.' }));
    } finally {
      busy.current = false;
    }
  }, [eventId, userId]);

  useEffect(() => {
    reload();
    const t = setInterval(reload, POLL_MS);
    const onVis = () => document.visibilityState === 'visible' && reload();
    const onOnline = () => reload();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(reload, 300); };
    const ch = supabase.channel(`event-${eventId}`);
    for (const table of ['items', 'incidents', 'incident_updates', 'broadcasts', 'event_members']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `event_id=eq.${eventId}` }, soon);
    }
    ch.subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => {
      clearInterval(t);
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
      supabase.removeChannel(ch);
    };
  }, [eventId, reload]);

  const me = useMemo(() => {
    const m = state.members.find((x) => x.user_id === userId);
    const role = isOwner ? 'owner' as const : m?.role ?? null;
    return {
      id: userId, role, dept: m?.dept_key ?? null, isOwner,
      canControl: isOwner || m?.role === 'controller',
    };
  }, [state.members, userId, isOwner]);

  const enabledDepts = useMemo(() => {
    const off = new Set(state.eventDepts.filter((d) => !d.enabled).map((d) => d.dept_key));
    return state.departments.filter((d) => !off.has(d.key));
  }, [state.departments, state.eventDepts]);

  const deptName = useCallback((k: string) => state.departments.find((d) => d.key === k)?.name ?? k, [state.departments]);
  const personName = useCallback((id: string | null) => {
    if (!id) return '';
    const p = state.people[id];
    return p ? (p.full_name || p.email) : 'Someone';
  }, [state.people]);

  return { ...state, live, reload, me, enabledDepts, deptName, personName };
}
