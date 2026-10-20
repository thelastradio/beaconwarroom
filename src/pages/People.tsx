import { useState } from 'react';
import { callApi, supabase, friendlyError } from '../lib/supabase';
import { useEv, toast } from '../lib/eventCtx';
import type { Member, Role } from '../lib/types';

export default function People() {
  const ev = useEv();
  const eventId = ev.event!.id;
  const others = ev.members.filter((m) => m.role !== 'poc');

  const remove = async (m: Member) => {
    if (!confirm(`Remove ${ev.personName(m.user_id)} from this event? They lose access immediately.`)) return;
    const { error } = await supabase.from('event_members').delete().eq('event_id', eventId).eq('user_id', m.user_id);
    if (error) return toast(friendlyError(error));
    toast('Access removed'); ev.reload();
  };

  return (
    <main className="page stack">
      <h1>People</h1>
      <p className="muted">Each person signs in with their email. Only people listed here can open this event; removing someone takes effect immediately.</p>

      <section className="card stack">
        <h2>Event Controllers and viewers</h2>
        {others.length === 0 && <p className="muted">None yet.</p>}
        {others.map((m) => (
          <div className="row" key={m.user_id}>
            <span className="grow">{ev.personName(m.user_id)} <span className="small muted">{ev.people[m.user_id]?.email}</span></span>
            <span className="tag">{m.role === 'controller' ? 'Event Controller' : 'Viewer'}</span>
            <button className="btn sm" onClick={() => remove(m)}>Remove</button>
          </div>
        ))}
        <InviteForm roles={['controller', 'viewer']} />
      </section>

      <section className="card stack">
        <h2>Department POCs</h2>
        <div className="scrollx">
          <table className="t">
            <thead><tr><th>Department</th><th>POC</th><th></th></tr></thead>
            <tbody>
              {ev.enabledDepts.map((d) => {
                const m = ev.members.find((x) => x.role === 'poc' && x.dept_key === d.key);
                return (
                  <tr key={d.key}>
                    <td>{d.name}</td>
                    <td>{m ? <>{ev.personName(m.user_id)}<div className="small muted">{ev.people[m.user_id]?.email}</div></> : <InviteForm roles={['poc']} dept={d.key} compact />}</td>
                    <td>{m && <button className="btn sm" onClick={() => remove(m)}>Remove</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function InviteForm({ roles, dept, compact }: { roles: Role[]; dept?: string; compact?: boolean }) {
  const ev = useEv();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>(roles[0]);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await callApi<{ invited: boolean; mailError: string | null }>('invite', { event_id: ev.event!.id, email, full_name: name, role, dept_key: dept });
      toast(r.mailError ? `${email} added, but the email failed (${r.mailError}). They can sign in from the app with their email.`
        : r.invited ? `Invite emailed to ${email}` : `${email} added. They sign in with their email.`);
      setEmail(''); setName('');
      ev.reload();
    } catch (err) {
      toast(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="row" onSubmit={save}>
      <input className="in grow" type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ minWidth: 180 }} aria-label="Email" />
      <input className="in grow" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 140 }} aria-label="Name" />
      {roles.length > 1 && (
        <select className="in" value={role} onChange={(e) => setRole(e.target.value as Role)} style={{ width: 'auto' }} aria-label="Role">
          <option value="controller">Event Controller</option><option value="viewer">Viewer</option>
        </select>
      )}
      <button className="btn primary sm" disabled={busy}>{busy ? 'Adding…' : compact ? 'Add POC' : 'Add person'}</button>
    </form>
  );
}
