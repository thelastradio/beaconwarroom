import { DateTime } from 'luxon';

export function fmtTime(iso: string | null, tz: string): string {
  if (!iso) return '';
  return DateTime.fromISO(iso).setZone(tz).toFormat('HH:mm');
}

export function fmtWhen(iso: string | null, tz: string, nowMs = Date.now()): string {
  if (!iso) return 'No due time';
  const d = DateTime.fromISO(iso).setZone(tz);
  const today = DateTime.fromMillis(nowMs).setZone(tz).startOf('day');
  const days = Math.round(d.startOf('day').diff(today, 'days').days);
  if (days === 0) return d.toFormat('HH:mm');
  if (days === -1) return `Yesterday ${d.toFormat('HH:mm')}`;
  if (days === 1) return `Tomorrow ${d.toFormat('HH:mm')}`;
  return d.toFormat(d.year === today.year ? 'd LLL, HH:mm' : 'd LLL yyyy, HH:mm');
}

export function fmtAgo(iso: string, nowMs = Date.now()): string {
  const s = Math.round((nowMs - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function untilLabel(iso: string, nowMs = Date.now()): string {
  const m = Math.round((Date.parse(iso) - nowMs) / 60000);
  const a = Math.abs(m);
  const t = a < 60 ? `${a} min` : a < 2880 ? `${Math.floor(a / 60)} h ${a % 60} min` : `${Math.floor(a / 1440)} days`;
  return m >= 0 ? `in ${t}` : `${t} ago`;
}

// "2026-11-22" + "18:30" in zone -> ISO UTC
export function localToIso(date: string, time: string, tz: string): string | null {
  const d = DateTime.fromISO(`${date}T${time}`, { zone: tz });
  return d.isValid ? d.toUTC().toISO() : null;
}

export function isValidZone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

export function guessZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function zoneList(): string[] {
  const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  return f ? f('timeZone') : ['UTC', 'Asia/Kolkata', 'Europe/London', 'America/New_York'];
}
