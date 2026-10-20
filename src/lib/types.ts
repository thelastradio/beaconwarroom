export type Role = 'controller' | 'poc' | 'viewer';
export type ItemStatus = 'not_started' | 'in_progress' | 'done' | 'blocked' | 'na';
export type Phase = 'planning' | 'build' | 'live' | 'breakdown' | 'debrief';

export interface Profile { id: string; email: string; full_name: string; is_owner: boolean }
export interface Department { key: string; name: string; owns: string; sort: number }
export interface EventRow {
  id: string; name: string; country: string; city: string; venue: string;
  venue_type: 'licensed_venue' | 'open_ground' | 'club' | 'other'; timezone: string;
  starts_at: string; ends_at: string; capacity: number | null; ticketed: boolean; alcohol: boolean;
  food_stalls: boolean; special_effects: boolean; artist_nationalities: string[]; created_at: string;
}
export interface EventDept { event_id: string; dept_key: string; enabled: boolean }
export interface Member { event_id: string; user_id: string; role: Role; dept_key: string | null }
export interface Item {
  id: string; event_id: string; dept_key: string; title: string; details: string; phase: Phase;
  due_at: string | null; critical: boolean; photo_required: boolean; status: ItemStatus;
  last_note: string | null; last_photo_path: string | null; updated_by: string | null; updated_at: string;
  source: 'template' | 'compliance' | 'manual'; sort: number;
}
export interface ItemUpdate {
  id: string; item_id: string; event_id: string; status: ItemStatus; note: string | null;
  photo_path: string | null; client_at: string | null; applied: boolean; created_by: string; created_at: string;
}
export interface Incident {
  id: string; event_id: string; level: 1 | 2 | 3 | 4; dept_key: string; location: string; title: string;
  description: string; photo_path: string | null; status: 'open' | 'closed'; raised_by: string; raised_at: string;
  closed_by: string | null; closed_at: string | null; close_note: string | null;
}
export interface IncidentUpdate { id: string; incident_id: string; event_id: string; note: string; created_by: string; created_at: string }
export interface Broadcast { id: string; event_id: string; dept_key: string | null; message: string; urgent: boolean; created_by: string; created_at: string }
export interface Finding {
  id: string; run_id: string; event_id: string; category: string; requirement: string; authority: string;
  lead_time_days: number | null; fee: string; source_url: string; source_quote: string; official: boolean;
  status: 'pending' | 'approved' | 'rejected'; reject_reason: string | null; item_id: string | null; created_at: string;
}
export interface ComplianceRun {
  id: string; event_id: string; status: 'running' | 'done' | 'failed'; categories_done: string[];
  reused_from: string | null; searches: number; input_tokens: number; output_tokens: number; error: string | null;
  started_at: string; finished_at: string | null;
}

export const STATUS_LABEL: Record<ItemStatus, string> = {
  not_started: 'Not started', in_progress: 'In progress', done: 'Done', blocked: 'Blocked', na: 'N/A',
};
export const LEVEL_LABEL: Record<number, string> = { 1: 'L1 Critical', 2: 'L2 Major', 3: 'L3 Minor', 4: 'L4 Note' };
export const PHASE_LABEL: Record<Phase, string> = {
  planning: 'Planning', build: 'Build and load-in', live: 'Doors and live show', breakdown: 'Breakdown and load-out', debrief: 'Debrief',
};
export const CATEGORY_LABEL: Record<string, string> = {
  permit: 'Event permit', venue_safety: 'Venue and structure safety', crowd_security: 'Crowd and security',
  music_rights: 'Music rights', noise: 'Noise and curfew', food: 'Food vendors', alcohol: 'Alcohol',
  waste: 'Waste and environment', traffic: 'Traffic and transport', immigration: 'Artist immigration',
  tax: 'Tax', insurance: 'Insurance', special_effects: 'Special effects', accessibility: 'Accessibility and safeguarding',
};
