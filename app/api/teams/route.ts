import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BASE = 'https://results.advancedeventsystems.com';
const DEFAULT_EVENT = 'PTAwMDAwNDEyNDA90';
const DEFAULT_DIV = '195174';

const AES_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'origin': 'https://results.advancedeventsystems.com',
  'referer': 'https://results.advancedeventsystems.com/',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tryFetchTeams(event: string, division: string, date: string): Promise<any[] | null> {
  try {
    const res = await fetch(`${BASE}/api/event/${event}/division/${division}/plays/${date}`, { headers: AES_HEADERS, next: { revalidate: 300 } } as any);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;

    const pools = data.filter((p: { PlayType: number }) => p.PlayType === 0)
      .sort((a: { Order: number }, b: { Order: number }) => a.Order - b.Order);

    if (pools.length === 0) return null;

    const teams = [];
    for (const pool of pools) {
      for (const t of (pool.Teams || [])) {
        teams.push({
          teamId: String(t.TeamId),
          teamName: t.TeamName,
          teamCode: t.TeamCode,
          club: t.Club?.Name || '',
          pool: pool.FullName,
          poolOrder: pool.Order,
        });
      }
    }
    return teams;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getEventDates(event: string, division: string): Promise<string[]> {
  try {
    // Try to fetch the event info to get available dates
    const res = await fetch(`${BASE}/api/event/${event}`, { headers: AES_HEADERS, next: { revalidate: 300 } } as any);
    if (!res.ok) return [];

    const data = await res.json();
    if (!data || !data.StartDate || !data.EndDate) return [];

    // Generate dates between StartDate and EndDate
    const start = new Date(data.StartDate);
    const end = new Date(data.EndDate);
    const dates: string[] = [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }

    return dates;
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const event = searchParams.get('event') || DEFAULT_EVENT;
  const division = searchParams.get('division') || DEFAULT_DIV;
  const date = searchParams.get('date');

  // Try specific date if provided
  if (date) {
    const teams = await tryFetchTeams(event, division, date);
    if (teams) {
      return NextResponse.json({ teams, event: searchParams.get('eventName') || 'Tournament', division: searchParams.get('divisionName') || 'Division' });
    }
  }

  // Try to get actual event dates from AES
  const eventDates = await getEventDates(event, division);

  if (eventDates.length > 0) {
    for (const tryDate of eventDates) {
      const teams = await tryFetchTeams(event, division, tryDate);
      if (teams && teams.length > 0) {
        return NextResponse.json({ teams, event: searchParams.get('eventName') || 'Tournament', division: searchParams.get('divisionName') || 'Division' });
      }
    }
  }

  // Fallback to common dates if event dates fetch fails
  const datesToTry = [
    '2026-05-09', '2026-05-10', // May tournament
    '2026-05-16', '2026-05-17', // Mid-May
    '2026-05-23', '2026-05-24', // Late May
    '2026-06-06', '2026-06-07', // June tournament
    '2026-06-13', '2026-06-14', // Mid-June
    '2026-06-20', '2026-06-21', // Late June
    '2026-06-27', '2026-06-28', // End of June
    '2026-07-11', '2026-07-12', // July
    '2026-07-18', '2026-07-19', // Mid-July
  ];

  for (const tryDate of datesToTry) {
    const teams = await tryFetchTeams(event, division, tryDate);
    if (teams && teams.length > 0) {
      return NextResponse.json({ teams, event: searchParams.get('eventName') || 'Tournament', division: searchParams.get('divisionName') || 'Division' });
    }
  }

  // If all dates fail, return empty teams
  return NextResponse.json({ teams: [], event: searchParams.get('eventName') || 'Tournament', division: searchParams.get('divisionName') || 'Division' });
}
