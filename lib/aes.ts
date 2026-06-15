// Shared helpers for the AES (Advanced Event Systems) public API.

export const AES_BASE = 'https://results.advancedeventsystems.com';

export const AES_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'origin': 'https://results.advancedeventsystems.com',
  'referer': 'https://results.advancedeventsystems.com/',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

// Fetch an AES endpoint. Returns parsed JSON, or null on any failure —
// including 204 No Content with an empty body, which AES returns once a
// team enters bracket play (calling res.json() on it would throw).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function aes(path: string, revalidate = 60): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await fetch(`${AES_BASE}${path}`, { headers: AES_HEADERS, next: { revalidate } } as any);
  if (!res.ok || res.status === 204) return null;
  const text = await res.text();
  if (!text || text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Encode a numeric AES event id into the token the results API expects, e.g.
// 42465 -> "PTAwMDAwNDI0NjU90". It is base64 of "=<id zero-padded to 10>=",
// plus a trailing "0" the results router requires (the clean base64 without
// it returns the SPA shell). Verified against several live events.
export function encodeEventId(numericId: number | string): string {
  return Buffer.from(`=${String(numericId).padStart(10, '0')}=`).toString('base64') + '0';
}

// Anchor a date string at local noon so the calendar day survives timezone
// conversion. Bare "YYYY-MM-DD" strings otherwise parse as UTC midnight,
// which renders as the previous day in timezones west of UTC.
function atLocalNoon(iso: string): Date {
  return new Date(iso.includes('T') ? iso : `${iso}T12:00:00`);
}

// Generate all dates between start and end (inclusive) as YYYY-MM-DD strings
export function generateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = atLocalNoon(startDate.split('T')[0]);
  const end = atLocalNoon(endDate.split('T')[0]);
  const pad = (n: number) => String(n).padStart(2, '0');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  return dates;
}

// AES uses 0001-01-01T00:00:00 as a sentinel for "no scheduled time"
// (e.g. a final that follows the semis)
function isUnscheduled(iso: string): boolean {
  return !iso || iso.startsWith('0001-');
}

export function fmtTime(iso: string) {
  if (isUnscheduled(iso)) return '';
  const [, time] = iso.split('T');
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function fmtDate(iso: string) {
  if (isUnscheduled(iso)) return '';
  return atLocalNoon(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function fmtDateLong(iso: string) {
  if (!iso) return '';
  return atLocalNoon(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Strip any location code suffix like (LS), (AZ), (NC), etc.
export function stripLocationCode(name: string): string {
  return name.replace(/\s*\([A-Z]{2}\)\s*$/, '').trim();
}

// Strip ALL trailing parenthetical suffixes: location codes + explicit ranks
// e.g. "Roots 14-2 Blue (LS) (37)" → "Roots 14-2 Blue"
export function stripAllSuffixes(name: string): string {
  return name.replace(/(\s*\([^)]+\))+\s*$/, '').trim();
}

export function ordinal(n: number): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}

// Extract all team text references from a bracket play's tree
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractAllSources(play: any): Set<string> {
  const sources = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walk(node: any) {
    if (!node) return;
    const m = node.Match || {};
    if (m.FirstTeamText) sources.add(m.FirstTeamText);
    if (m.SecondTeamText) sources.add(m.SecondTeamText);
    walk(node.TopSource);
    walk(node.BottomSource);
  }
  for (const r of (play.Roots || [])) { walk(r); walk(r.TopSource); walk(r.BottomSource); }
  return sources;
}
