import { useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: false } });
    setBusy(false);
    if (error && /only request this after/i.test(error.message)) {
      // a code was emailed moments ago (for example with the invite): let them use it
      setInfo('A code was emailed to you a moment ago. Use the latest email.');
      setStep('code');
      return;
    }
    if (error) {
      setError(/signups not allowed|not found|Signups/i.test(error.message)
        ? 'This email has no access. Ask the event owner to add you.'
        : friendlyError(error));
      return;
    }
    setStep('code');
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setError(/expired|invalid/i.test(error.message) ? 'That code is wrong or has expired. Request a new one.' : friendlyError(error));
  };

  return (
    <main className="login">
      {step === 'email' ? (
        <form className="card" onSubmit={sendCode}>
          <div>
            <h1>Beacon War Room</h1>
            <p className="muted">Sign in with the email your event owner added.</p>
          </div>
          <label className="f">Email
            <input className="in" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn primary" disabled={busy || !email}>{busy ? 'Sending…' : 'Email me a sign-in code'}</button>
        </form>
      ) : (
        <form className="card" onSubmit={verify}>
          <div>
            <h1>Check your email</h1>
            <p className="muted">Enter the 6-digit code sent to {email}. It works for one hour.</p>
            {info && <p className="small">{info}</p>}
          </div>
          <label className="f">Code
            <input className="in code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
          </label>
          {error && <div className="err" role="alert">{error}</div>}
          <button className="btn primary" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Sign in'}</button>
          <button type="button" className="btn ghost" onClick={() => { setStep('email'); setCode(''); setError(null); }}>Use a different email</button>
        </form>
      )}
    </main>
  );
}
