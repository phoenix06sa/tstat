import { NextResponse } from 'next/server';
import { aes, generateDateRange } from '@/lib/aes';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Teams for one division: first event date that has published pools wins.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function teamsForDivision(event: string, division: string, dates: string[]): Promise<any[]> {
  for (const date of dates) {
    const data = await aes(`/api/event/${event}/division/${division}/plays/${date}`, 300);
    if (!Array.isArray(data)) continue;
    const pools = data.filter((p: { PlayType: number }) => p.PlayType === 0)
      .sort((a: { Order: number }, b: { Order: number }) => a.Order - b.Order);
    if (pools.length === 0) continue;
    const teams = [];
    for (const pool of pools) {
      for (const t of (pool.Teams || [])) {
        teams.push({
          teamId: String(t.TeamId),
          teamName: t.TeamName,
          teamCode: t.TeamCode,
          club: t.Club?.Name || '',
          pool: pool.FullName,
        });
      }
    }
    if (teams.length) return teams;
  }
  return [];
}

// Every team in an event, across all divisions, each tagged with its division.
// Lets the setup flow search for a team by name when the division is unknown
// (e.g. tracking a friend's team). Divisions are fetched in parallel; the AES
// responses are cached (revalidate 300) so repeat searches are fast.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const event = searchParams.get('event');
  if (!event) {
    return NextResponse.json({ error: 'Missing required param: event' }, { status: 400 });
  }

  const info = await aes(`/api/event/${event}`, 300);
  if (!info) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }
  const eventName = info.Name || 'Tournament';
  const divisions = (info.Divisions || []).map((d: { DivisionId: number; Name: string }) => ({
    id: String(d.DivisionId),
    name: d.Name,
  }));
  const dates = info.StartDate && info.EndDate
    ? generateDateRange(info.StartDate, info.EndDate)
    : [];

  const perDivision = await Promise.all(
    divisions.map(async (d: { id: string; name: string }) => {
      const teams = await teamsForDivision(event, d.id, dates);
      return teams.map(t => ({ ...t, divisionId: d.id, divisionName: d.name }));
    })
  );

  return NextResponse.json({
    event: eventName,
    teams: perDivision.flat(),
    divisionCount: divisions.length,
  });
}
