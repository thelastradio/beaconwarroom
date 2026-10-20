// POST /api/compliance
//   { action: 'start', event_id, force? }               -> { run_id, categories, reused }
//   { action: 'category', event_id, run_id, category }  -> { added, done }
// Researches one category per call (keeps each call well inside the function time limit).
import { caller, env, handle, membership, readBody, send } from './_lib.js';

export const CATEGORIES = {
  permit: 'Event or public performance permit/licence: who issues it (city, council, police), documents, lead time, fee',
  venue_safety: 'Venue and temporary structure safety: fire, electrical and structural sign-offs for stages, tents and stalls',
  crowd_security: 'Crowd capacity limits and the licensing rules for private security providers/stewards',
  music_rights: 'Music rights: which collecting societies license live performance and recorded music at events, and who must hold the licence',
  noise: 'Noise and curfew: sound limits, PA/loudspeaker permissions, finish times',
  food: 'Food vendors at events: vendor registration, hygiene rules, gas cylinder/LPG rules',
  alcohol: 'Alcohol at events: temporary/event liquor permit, serving hours, age checks',
  waste: 'Waste and environment: notice to local body, segregation and disposal rules for events',
  traffic: 'Traffic and transport: road closure, parking and emergency access approvals',
  immigration: 'Artist immigration: work visas or permit exemptions for touring performers from the artists\' countries',
  tax: 'Tax: sales tax/VAT/GST on event tickets, and withholding tax on fees paid to foreign performers',
  insurance: 'Insurance: public liability and any cover the authority or venue type requires',
  special_effects: 'Special effects: drones, pyrotechnics and lasers at events',
  accessibility: 'Accessibility and safeguarding: legal duties on disabled access and under-18 attendees at events',
};

const LABEL = { licensed_venue: 'a licensed venue (auditorium/theatre/hall)', open_ground: 'an open ground or outdoor site', club: 'a club or bar', other: 'a venue' };

export function categoriesFor(ev) {
  return Object.keys(CATEGORIES).filter((c) => {
    if (c === 'food') return ev.food_stalls;
    if (c === 'alcohol') return ev.alcohol;
    if (c === 'special_effects') return ev.special_effects;
    if (c === 'immigration') return (ev.artist_nationalities || []).some((n) => n.trim().toLowerCase() !== ev.country.trim().toLowerCase());
    return true;
  });
}

export function cacheKey(ev) {
  const nat = [...(ev.artist_nationalities || [])].map((s) => s.trim().toLowerCase()).sort().join(',');
  return [ev.country, ev.city, ev.venue_type, ev.ticketed, ev.alcohol, ev.food_stalls, ev.special_effects, nat]
    .map((x) => String(x).trim().toLowerCase()).join('|');
}

async function canRun(admin, profile, eventId, userId) {
  if (profile?.is_owner) return true;
  const m = await membership(admin, eventId, userId);
  return m && (m.role === 'controller' || (m.role === 'poc' && m.dept_key === 'licensing'));
}

function prompt(ev, category) {
  const nat = (ev.artist_nationalities || []).join(', ') || 'not specified';
  return `You are researching legal and regulatory requirements for a live comedy/music event. Be precise and conservative.

Event: ${ev.name}
Location: ${ev.city}, ${ev.country}
Venue: ${ev.venue || 'not named'} — ${LABEL[ev.venue_type] || 'a venue'}
Capacity: ${ev.capacity ?? 'unknown'}; ticketed: ${ev.ticketed ? 'yes' : 'no'}; alcohol: ${ev.alcohol ? 'yes' : 'no'}; food stalls: ${ev.food_stalls ? 'yes' : 'no'}; special effects: ${ev.special_effects ? 'yes' : 'no'}
Artists' nationalities: ${nat}
Show date: ${ev.starts_at.slice(0, 10)}

Research ONLY this category: ${CATEGORIES[category]}.

Rules:
- Search government, regulator, police, council and official licensing-body websites first. Use secondary sources only if no official page exists, and mark them official=false.
- Only include requirements that apply to this event's city, venue type and facts.
- source_url must be a page you actually found in your searches. source_quote must be a short exact quote from that page supporting the requirement.
- lead_time_days: how many days before the event the application must be made, as an integer, only if the source states it; otherwise null.
- fee: as stated by the source, else "".
- If you find nothing reliable, return an empty list. Never guess.

Return 0 to 6 findings as JSON inside <json></json> tags, exactly this shape:
<json>{"findings":[{"requirement":"","authority":"","lead_time_days":null,"fee":"","source_url":"","source_quote":"","official":true}]}</json>`;
}

async function callClaude(messages) {
  const base = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  const r = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
      messages,
    }),
  });
  const j = await r.json();
  if (!r.ok) throw { status: 502, message: `Research service error: ${j?.error?.message || r.status}` };
  return j;
}

// Runs the conversation (continuing on pause_turn), returns {text, urls, usage}
export async function research(ev, category) {
  const messages = [{ role: 'user', content: prompt(ev, category) }];
  const urls = new Set();
  const usage = { input: 0, output: 0, searches: 0 };
  let text = '';
  for (let turn = 0; turn < 3; turn++) {
    const res = await callClaude(messages);
    usage.input += res.usage?.input_tokens || 0;
    usage.output += res.usage?.output_tokens || 0;
    usage.searches += res.usage?.server_tool_use?.web_search_requests || 0;
    for (const block of res.content || []) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content) if (r.url) urls.add(normUrl(r.url));
      }
      if (block.type === 'text') {
        text += block.text;
        for (const c of block.citations || []) if (c.url) urls.add(normUrl(c.url));
      }
    }
    if (res.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: res.content });
  }
  return { text, urls, usage };
}

export function normUrl(u) {
  try {
    const x = new URL(u);
    return (x.host.replace(/^www\./, '') + x.pathname.replace(/\/$/, '')).toLowerCase();
  } catch {
    return String(u).toLowerCase();
  }
}

export function parseFindings(text, urls) {
  const m = text.match(/<json>([\s\S]*?)<\/json>/);
  if (!m) return [];
  let parsed;
  try { parsed = JSON.parse(m[1]); } catch { return []; }
  const list = Array.isArray(parsed?.findings) ? parsed.findings.slice(0, 6) : [];
  return list
    .filter((f) => f && typeof f.requirement === 'string' && f.requirement.trim())
    .map((f) => {
      const url = String(f.source_url || '').trim();
      const seen = url && urls.has(normUrl(url));
      const lead = Number.isInteger(f.lead_time_days) && f.lead_time_days >= 0 && f.lead_time_days < 400 ? f.lead_time_days : null;
      return {
        requirement: f.requirement.trim().slice(0, 500),
        authority: String(f.authority || '').trim().slice(0, 200),
        lead_time_days: lead,
        fee: String(f.fee || '').trim().slice(0, 200),
        source_url: seen ? url : '',
        source_quote: seen ? String(f.source_quote || '').trim().slice(0, 600) : '',
        // official only if the model says so AND the link really came back from search
        official: Boolean(f.official) && Boolean(seen),
      };
    });
}

export default handle(async (req, res) => {
  const { profile, user, admin } = await caller(req);
  const b = await readBody(req);
  if (!b.event_id) throw { status: 400, message: 'event_id is required' };
  if (!(await canRun(admin, profile, b.event_id, user.id))) throw { status: 403, message: 'Only the Controller or Licensing POC can run compliance research' };
  const { data: ev } = await admin.from('events').select('*').eq('id', b.event_id).single();
  if (!ev) throw { status: 404, message: 'Event not found' };
  const cats = categoriesFor(ev);

  if (b.action === 'start') {
    const key = cacheKey(ev);
    if (!b.force) {
      const since = new Date(Date.now() - 90 * 864e5).toISOString();
      const { data: prev } = await admin.from('compliance_runs').select('id')
        .eq('cache_key', key).eq('status', 'done').is('reused_from', null).gte('finished_at', since)
        .order('finished_at', { ascending: false }).limit(1).maybeSingle();
      if (prev) {
        const { data: run } = await admin.from('compliance_runs').insert({
          event_id: ev.id, cache_key: key, status: 'done', reused_from: prev.id,
          categories_done: cats, started_by: user.id, finished_at: new Date().toISOString(),
        }).select('id').single();
        const { data: old } = await admin.from('compliance_findings').select('*').eq('run_id', prev.id);
        const rows = (old || []).filter((f) => cats.includes(f.category)).map((f) => ({
          run_id: run.id, event_id: ev.id, category: f.category, requirement: f.requirement, authority: f.authority,
          lead_time_days: f.lead_time_days, fee: f.fee, source_url: f.source_url, source_quote: f.source_quote, official: f.official,
        }));
        if (rows.length) await admin.from('compliance_findings').insert(rows);
        return send(res, 200, { run_id: run.id, categories: [], reused: true, added: rows.length });
      }
    }
    const { data: run, error } = await admin.from('compliance_runs')
      .insert({ event_id: ev.id, cache_key: key, status: 'running', started_by: user.id }).select('id').single();
    if (error) throw { status: 500, message: error.message };
    return send(res, 200, { run_id: run.id, categories: cats, reused: false });
  }

  if (b.action === 'resume') {
    const { data: run } = await admin.from('compliance_runs').select('*').eq('id', b.run_id).eq('event_id', ev.id).single();
    if (!run || run.status !== 'running') throw { status: 409, message: 'This research run is not active' };
    return send(res, 200, { run_id: run.id, categories: cats.filter((c) => !run.categories_done.includes(c)) });
  }

  if (b.action === 'category') {
    if (!cats.includes(b.category)) throw { status: 400, message: 'Category does not apply to this event' };
    const { data: run } = await admin.from('compliance_runs').select('*').eq('id', b.run_id).eq('event_id', ev.id).single();
    if (!run || run.status !== 'running') throw { status: 409, message: 'This research run is not active' };
    if (run.categories_done.includes(b.category)) return send(res, 200, { added: 0, done: false, skipped: true });
    let found;
    try {
      const { text, urls, usage } = await research(ev, b.category);
      found = { list: parseFindings(text, urls), usage };
    } catch (e) {
      await admin.from('compliance_runs').update({ error: String(e?.message || e) }).eq('id', run.id);
      throw e;
    }
    if (found.list.length) {
      await admin.from('compliance_findings').insert(found.list.map((f) => ({ ...f, run_id: run.id, event_id: ev.id, category: b.category })));
    }
    const doneCats = [...run.categories_done, b.category];
    const finished = cats.every((c) => doneCats.includes(c));
    await admin.from('compliance_runs').update({
      categories_done: doneCats,
      searches: run.searches + found.usage.searches,
      input_tokens: run.input_tokens + found.usage.input,
      output_tokens: run.output_tokens + found.usage.output,
      ...(finished ? { status: 'done', finished_at: new Date().toISOString() } : {}),
    }).eq('id', run.id);
    return send(res, 200, { added: found.list.length, done: finished });
  }

  throw { status: 400, message: 'Unknown action' };
});
