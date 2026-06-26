import { NextResponse } from 'next/server';
import { aes, generateDateRange, fmtDate } from '@/lib/aes';
import { buildPoolStandings } from '@/lib/tournament/standings';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Division-wide data for the hub's non-team views: everyone's pool play, the
// starting seed list, and what's scheduled on each court. Team-agnostic, so it
// powers the Division Pool Play, Seeding, and Court Play screens from one fetch.

// "North 19" / "68 ICC" sort in human order (2 before 10).
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function anyScored(node: any): boolean {
  if (!node) return false;
  if (node.Match?.HasScores) return true;
  return anyScored(node.TopSource) || anyScored(node.BottomSource);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const event = searchParams.get('event');
  const division = searchParams.get('division');
  if (!event || !division) {
    return NextResponse.json({ error: 'Missing required params: event, division' }, { status: 400 });
  }

  const info = await aes(`/api/event/${event}`, 60);
  if (!info) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  const dates = info.StartDate && info.EndDate ? generateDateRange(info.StartDate, info.EndDate) : [];
  const playsByDay = await Promise.all(
    dates.map(d => aes(`/api/event/${event}/division/${division}/plays/${d}`, 60))
  );

  // Collect every pool round (PlayType 0), de-duped by full name — a pool can
  // appear on more than one day when its matches span days.
  const seenPool = new Set<string>();
  const pools: {
    name: string; courts: string[]; date: string; order: number;
    complete: boolean; standings: ReturnType<typeof buildPoolStandings>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    teams: any[];
  }[] = [];
  let anyBracketScored = false;
  // Starting seed per team, read from round-1 pool TeamText: "Name (LOC) (N)".
  // Re-pool rounds use slot refs ("1st-P1 (1)") which lack the (LOC) group, so
  // this regex only matches genuine starting seeds. Events without seeds (e.g.
  // AAU) simply yield none.
  const seedByCode = new Map<string, { seed: number; teamName: string; teamCode: string; club: string }>();

  for (let i = 0; i < dates.length; i++) {
    const plays = playsByDay[i];
    if (!Array.isArray(plays)) continue;
    for (const p of plays) {
      if (p.PlayType === 0) {
        const key = p.CompleteFullName || p.FullName || '';
        if (seenPool.has(key)) continue;
        seenPool.add(key);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const teams: any[] = p.Teams || [];
        // buildPoolStandings already orders by FinishRank, else live performance
        const standings = buildPoolStandings(teams, '');
        pools.push({
          name: p.CompleteFullName || p.FullName || '',
          courts: (p.Courts || []).map((c: { Name: string }) => c.Name),
          date: fmtDate(dates[i]),
          order: p.Order ?? 999,
          complete: teams.length > 0 && teams.every(t => t.FinishRank !== null && t.FinishRank !== undefined),
          standings,
          teams,
        });
        for (const t of teams) {
          const m = (t.TeamText || '').match(/\([A-Za-z]{2,}\)\s*\((\d+)\)\s*$/);
          if (m && t.TeamCode && !seedByCode.has(t.TeamCode)) {
            seedByCode.set(t.TeamCode, { seed: parseInt(m[1]), teamName: t.TeamName, teamCode: t.TeamCode, club: t.Club?.Name || '' });
          }
        }
      } else if (p.PlayType === 1 && !anyBracketScored) {
        for (const r of (p.Roots || [])) { if (anyScored(r)) { anyBracketScored = true; break; } }
      }
    }
  }

  pools.sort((a, b) => a.order - b.order || naturalCompare(a.name, b.name));

  const poolPlayComplete = anyBracketScored || (pools.length > 0 && pools.every(p => p.complete));
  const seeds = [...seedByCode.values()].sort((a, b) => a.seed - b.seed);

  // Court → which pools (and their teams) play there.
  const courtMap = new Map<string, { poolName: string; date: string; complete: boolean; teams: { teamName: string; teamCode: string }[] }[]>();
  for (const pool of pools) {
    const teams = pool.standings.map(s => ({ teamName: s.teamName, teamCode: s.teamCode }));
    for (const court of pool.courts) {
      if (!courtMap.has(court)) courtMap.set(court, []);
      courtMap.get(court)!.push({ poolName: pool.name, date: pool.date, complete: pool.complete, teams });
    }
  }
  const courts = [...courtMap.entries()]
    .map(([name, entries]) => ({ name, entries }))
    .sort((a, b) => naturalCompare(a.name, b.name));

  return NextResponse.json({
    event: info.Name || 'Tournament',
    poolPlayComplete,
    pools: pools.map(({ teams: _teams, ...rest }) => rest), // drop raw teams from payload
    seeds,
    courts,
  });
}
