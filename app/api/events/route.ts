import { NextResponse } from 'next/server';
import { encodeEventId } from '@/lib/aes';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// AES's public event directory (the same data behind advancedeventsystems.com/events).
// It's an OData endpoint, so we filter by name server-side rather than pulling
// the full ~8 MB list. CORS is closed on it, so this proxy is required.
const EVENTS_API = 'https://www.advancedeventsystems.com/api/events';
const HEADERS = {
  accept: 'application/json, text/plain, */*',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

interface AesEvent { eventId: number; name: string; startDate: string; endDate: string; locationName?: string; host?: string; isPastEvent?: boolean }

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim();
  // Require a couple characters so we never request the entire directory
  if (q.length < 2) return NextResponse.json({ events: [] });

  // OData filter; escape single quotes by doubling them
  const safe = q.toLowerCase().replace(/'/g, "''");
  const filter = `contains(tolower(name),'${safe}')`;
  const url = `${EVENTS_API}?$filter=${encodeURIComponent(filter)}&$orderby=${encodeURIComponent('startDate desc')}&$top=25`;

  try {
    const res = await fetch(url, { headers: HEADERS, next: { revalidate: 300 } } as RequestInit);
    if (!res.ok) return NextResponse.json({ events: [], error: `HTTP ${res.status}` }, { status: 502 });
    const data = await res.json();
    const events = ((data.value || []) as AesEvent[]).map(e => ({
      eventId: encodeEventId(e.eventId),   // token the results API/tracker uses
      numericId: e.eventId,
      name: e.name,
      startDate: e.startDate,
      endDate: e.endDate,
      location: e.locationName || e.host || '',
      isPast: !!e.isPastEvent,
    }));
    return NextResponse.json({ events });
  } catch (e) {
    return NextResponse.json({ events: [], error: String(e) }, { status: 500 });
  }
}
