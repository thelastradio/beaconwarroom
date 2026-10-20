import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { callApi, supabase, friendlyError } from '../lib/supabase';
import { useEv, toast } from '../lib/eventCtx';
import { fmtWhen } from '../lib/time';
import { CATEGORY_LABEL, type ComplianceRun, type Finding } from '../lib/types';

// Estimate only: web search US$10 per 1,000 searches plus model tokens (Sonnet-class pricing).
const estCost = (r: ComplianceRun) => r.searches * 0.01 + (r.input_tokens / 1e6) * 2 + (r.output_tokens / 1e6) * 10;

export default function Compliance() {
  const ev = useEv();
  const e = ev.event!;
  const [params, setParams] = useSearchParams();
  const [runs, setRuns] = useState<ComplianceRun[] | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const load = useCallback(async () => {
    const [r, f] = await Promise.all([
      supabase.from('compliance_runs').select('*').eq('event_id', e.id).order('started_at', { ascending: false }),
      supabase.from('compliance_findings').select('*').eq('event_id', e.id).order('created_at'),
    ]);
    setRuns((r.data as ComplianceRun[]) || []);
    setFindings((f.data as Finding[]) || []);
  }, [e.id]);
  useEffect(() => { load(); }, [load]);

  const runCategories = async (runId: string, cats: string[]) => {
    for (let i = 0; i < cats.length; i++) {
      setProgress({ done: i, total: cats.length, current: CATEGORY_LABEL[cats[i]] || cats[i] });
      let tries = 0;
      for (;;) {
        try {
          await callApi('compliance', { action: 'category', event_id: e.id, run_id: runId, category: cats[i] });
          break;
        } catch (err) {
          if (++tries >= 2) throw err;
        }
      }
      await load();
    }
    setProgress(null);
  };

  const start = async (force = false) => {
    setError(null);
    try {
      setProgress({ done: 0, total: 1, current: 'Checking saved research for this city' });
      const r = await callApi<{ run_id: string; categories: string[]; reused: boolean; added?: number }>('compliance', { action: 'start', event_id: e.id, force });
      if (r.reused) {
        setProgress(null);
        toast(`Reused research from another event in ${e.city} (${r.added} findings). Run fresh research to re-check.`);
        await load();
        return;
      }
      await runCategories(r.run_id, r.categories);
      toast('Research finished. Review each finding.');
    } catch (err) {
      setProgress(null);
      setError(`${friendlyError(err)} You can run the research again; finished categories are kept.`);
      await load();
    }
  };

  const resume = async (run: ComplianceRun) => {
    setError(null);
    try {
      const r = await callApi<{ run_id: string; categories: string[] }>('compliance', { action: 'resume', event_id: e.id, run_id: run.id });
      await runCategories(r.run_id, r.categories);
      toast('Research finished. Review each finding.');
    } catch (err) {
      setProgress(null);
      setError(friendlyError(err));
      await load();
    }
  };

  useEffect(() => {
    if (runs && params.get('start') === '1' && !started.current) {
      started.current = true;
      setParams({}, { replace: true });
      if (runs.length === 0) start();
    }
  }, [runs]); // eslint-disable-line react-hooks/exhaustive-deps

  const review = async (f: Finding, approve: boolean) => {
    let reason: string | null = null;
    if (!approve) {
      reason = prompt('Why is this not needed? (kept in the record)');
      if (!reason?.trim()) return;
    }
    const { error } = await supabase.rpc('review_finding', { p_id: f.id, p_approve: approve, p_reason: reason });
    if (error) return toast(friendlyError(error));
    toast(approve ? 'Approved: task added to Licensing & Compliance' : 'Rejected');
    load(); ev.reload();
  };

  const latest = runs?.[0];
  const current = latest ? findings.filter((f) => f.run_id === latest.id) : [];
  const pending = current.filter((f) => f.status === 'pending').length;
  const cats = [...new Set(current.map((f) => f.category))];
  const startMs = Date.parse(e.starts_at);
  const tooLate = (f: Finding) => f.lead_time_days != null && startMs - f.lead_time_days * 864e5 < Date.now();

  return (
    <main className="page stack">
      <div className="row">
        <h1 className="grow">Compliance</h1>
        <button className="btn primary" disabled={!!progress} onClick={() => start(!!latest)}>{latest ? 'Run fresh research' : 'Run research'}</button>
      </div>
      <p className="muted">Researches the rules for {e.city}, {e.country} from official sources first. This is research, not legal advice: the local promoter, venue or a lawyer confirms each approved item.</p>
      {progress && (
        <div className="card" role="status">
          <b>Researching {progress.current}…</b>
          <div className="muted small">{progress.done} of {progress.total} categories done. Each takes up to a minute. Keep this page open.</div>
        </div>
      )}
      {error && <div className="err" role="alert">{error}</div>}
      {latest && (
        <div className="small muted">
          Latest research {fmtWhen(latest.started_at, e.timezone)} · {latest.reused_from ? 'reused from an earlier event' : `${latest.searches} searches, about US$${estCost(latest).toFixed(2)}`}
          {latest.status === 'running' && !progress && <> · incomplete. <button className="btn sm" onClick={() => resume(latest)}>Finish research</button></>}
          {pending > 0 && <> · <b style={{ color: 'var(--amber)' }}>{pending} waiting for review</b></>}
        </div>
      )}
      {runs && runs.length === 0 && !progress && <p className="muted">No research yet.</p>}
      {latest && latest.status === 'done' && current.length === 0 && <p className="muted">The research found nothing it could source. Check requirements with the venue and local authority.</p>}
      {cats.map((c) => (
        <section key={c} className="stack" style={{ gap: 8 }}>
          <h2>{CATEGORY_LABEL[c] || c}</h2>
          {current.filter((f) => f.category === c).map((f) => (
            <div key={f.id} className="card stack" style={{ gap: 6, opacity: f.status === 'rejected' ? 0.55 : 1 }}>
              <div className="row">
                <b className="grow">{f.requirement}</b>
                {f.official ? <span className="tag">Official source</span> : <span className="tag crit">Unverified — check</span>}
                {tooLate(f) && f.status !== 'rejected' && <span className="chip blocked">Inside lead time</span>}
              </div>
              <div className="small muted">
                {[f.authority && `Authority: ${f.authority}`, f.lead_time_days != null && `Apply ${f.lead_time_days} days before`, f.fee && `Fee: ${f.fee}`].filter(Boolean).join(' · ') || 'No authority, lead time or fee stated'}
              </div>
              {f.source_quote && <blockquote className="note" style={{ margin: 0 }}>“{f.source_quote}”</blockquote>}
              {f.source_url ? <a href={f.source_url} target="_blank" rel="noreferrer" className="small">{f.source_url}</a> : <span className="small muted">No source link the research could confirm.</span>}
              {f.status === 'pending' ? (
                <div className="row"><button className="btn primary sm" onClick={() => review(f, true)}>Approve: add as task</button><button className="btn sm" onClick={() => review(f, false)}>Not needed</button></div>
              ) : (
                <div className="small">{f.status === 'approved' ? 'Approved: task added' : `Rejected: ${f.reject_reason}`}</div>
              )}
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
