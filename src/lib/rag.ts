import type { Incident, Item } from './types';

export type Rag = 'green' | 'amber' | 'red';

const open = (i: Item) => i.status !== 'done' && i.status !== 'na';

export function isOverdue(i: Item, now: number): boolean {
  return open(i) && !!i.due_at && Date.parse(i.due_at) < now;
}

export function isDueSoonNotStarted(i: Item, now: number): boolean {
  if (i.status !== 'not_started' || !i.due_at) return false;
  const t = Date.parse(i.due_at);
  return t >= now && t - now <= 30 * 60000;
}

// Spec rules: red = blocked item, open L1/L2 incident, or critical item past due.
// amber = item past due, or due within 30 min and not started. green otherwise.
export function deptRag(items: Item[], incidents: Incident[], now: number): Rag {
  if (items.some((i) => i.status === 'blocked')) return 'red';
  if (incidents.some((x) => x.status === 'open' && x.level <= 2)) return 'red';
  if (items.some((i) => i.critical && isOverdue(i, now))) return 'red';
  if (items.some((i) => isOverdue(i, now) || isDueSoonNotStarted(i, now))) return 'amber';
  return 'green';
}

export function ragReason(items: Item[], incidents: Incident[], now: number): string {
  const blocked = items.filter((i) => i.status === 'blocked').length;
  const inc = incidents.filter((x) => x.status === 'open' && x.level <= 2).length;
  const critLate = items.filter((i) => i.critical && isOverdue(i, now)).length;
  const late = items.filter((i) => isOverdue(i, now)).length;
  const soon = items.filter((i) => isDueSoonNotStarted(i, now)).length;
  const parts: string[] = [];
  if (blocked) parts.push(`${blocked} blocked`);
  if (inc) parts.push(`${inc} major incident${inc > 1 ? 's' : ''}`);
  if (critLate) parts.push(`${critLate} critical overdue`);
  else if (late) parts.push(`${late} overdue`);
  if (soon) parts.push(`${soon} due within 30 min`);
  return parts.join(', ') || 'On track';
}

export function progress(items: Item[]): { done: number; total: number } {
  const counted = items.filter((i) => i.status !== 'na');
  return { done: counted.filter((i) => i.status === 'done').length, total: counted.length };
}
