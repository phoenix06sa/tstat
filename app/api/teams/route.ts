import { NextResponse } from 'next/server';
import { aes, generateDateRange } from '@/lib/aes';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tryFetchTeams(event: string, division: string, date: string): Promise<any[] | null> {
  const data = await aes(`/api/event/${event}/division/${division}/plays/${date}`, 300);
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
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const event = searchParams.get('event');
  const division = searchParams.get('division');
  const date = searchParams.get('date');

  if (!event || !division) {
    return NextResponse.json({ error: 'Missing required params: event, division' }, { status: 400 });
  }

  // Fetch event metadata for the real tournament name and date range
  const eventInfo = await aes(`/api/event/${event}`, 300);
  const eventName = eventInfo?.Name || searchParams.get('eventName') || 'Tournament';
  const divisionName = (eventInfo?.Divisions || []).find((d: { DivisionId: number }) => String(d.DivisionId) === division)?.Name
    || searchParams.get('divisionName') || 'Division';

  // Try specific date if provided
  if (date) {
    const teams = await tryFetchTeams(event, division, date);
    if (teams) {
      return NextResponse.json({ teams, event: eventName, division: divisionName });
    }
  }

  // Try each of the event's dates until teams appear
  const eventDates = eventInfo?.StartDate && eventInfo?.EndDate
    ? generateDateRange(eventInfo.StartDate, eventInfo.EndDate)
    : [];

  for (const tryDate of eventDates) {
    const teams = await tryFetchTeams(event, division, tryDate);
    if (teams && teams.length > 0) {
      return NextResponse.json({ teams, event: eventName, division: divisionName });
    }
  }

  // No teams found on any event date
  return NextResponse.json({ teams: [], event: eventName, division: divisionName });
}
