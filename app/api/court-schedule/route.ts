import { NextResponse } from 'next/server';
import { aes, generateDateRange, fmtTime, stripAllSuffixes } from '@/lib/aes';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Per-court, per-day match schedule for a division: pick a day + court, see the
// time-ordered matches (both teams, times). AES's plays endpoint only carries
// the bracket match grid, not pool matches — so we aggregate every team's
// schedule (which DOES carry court + time + both teams for pool AND bracket
// matches) and de-dupe by MatchId.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function teamName(name: string, text: string): string {
  if (name) return name;
  const t = text || '';
  if (/^(Winner|Loser) of/i.test(t)) return t.replace(/\s*\(\d+\)\s*$/, '');
  return stripAllSuffixes(t) || 'TBD';
}

async function chunked<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  }
  return out;
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

  // Collect every team id in the division from the pool rosters (all days, since
  // re-pool events seed new pools per round).
  const playsByDay = await Promise.all(dates.map(d => aes(`/api/event/${event}/division/${division}/plays/${d}`, 60)));
  const teamIds = new Set<string>();
  for (const plays of playsByDay) {
    if (!Array.isArray(plays)) continue;
    for (const p of plays) {
      if (p.PlayType !== 0) continue;
      for (const t of (p.Teams || [])) if (t.TeamId != null) teamIds.add(String(t.TeamId));
    }
  }

  // Pull each team's past + current schedule and gather every match.
  const reqs: { tid: string; kind: 'past' | 'current' }[] = [];
  for (const tid of teamIds) { reqs.push({ tid, kind: 'past' }); reqs.push({ tid, kind: 'current' }); }
  const schedules = await chunked(reqs, 24, r =>
    aes(`/api/event/${event}/division/${division}/team/${r.tid}/schedule/${r.kind}`, 60));

  type Row = { matchId: number; date: string; start: string; time: string; court: string; play: string; team1: string; team2: string; team1Id: number | null; team2Id: number | null; hasScores: boolean; scoreText: string };
  const byId = new Map<number, Row>();
  const courts = new Set<string>();
  const days = new Set<string>();

  for (const sched of schedules) {
    if (!Array.isArray(sched)) continue;
    for (const entry of sched) {
      // `past` returns one Match per entry; `current` groups Matches under a Play
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const matches: any[] = entry.Matches || (entry.Match ? [entry.Match] : []);
      const playName = entry.Play?.FullName || '';
      for (const m of matches) {
        const court = m.Court?.Name;
        const start: string = m.ScheduledStartDateTime || '';
        if (!court || !start || m.MatchId == null) continue;
        if (byId.has(m.MatchId)) continue;
        const date = start.split('T')[0];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sets = (m.Sets || []).filter((s: any) => s.ScoreText);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const scoreText = sets.map((s: any) => s.ScoreText).join(', ');
        byId.set(m.MatchId, {
          matchId: m.MatchId,
          date,
          start,
          time: fmtTime(start),
          court,
          play: playName,
          team1: teamName(m.FirstTeamName, m.FirstTeamText),
          team2: teamName(m.SecondTeamName, m.SecondTeamText),
          team1Id: m.FirstTeamId ?? null,
          team2Id: m.SecondTeamId ?? null,
          hasScores: !!m.HasScores,
          scoreText,
        });
        courts.add(court);
        days.add(date);
      }
    }
  }

  // Merge in bracket matches straight from the plays endpoint — these include
  // future, not-yet-assigned slots ("Winner of Match 1 vs …") that no team's
  // schedule has yet. Same MatchId, so they de-dupe against the above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walkBracket = (node: any, playName: string) => {
    if (!node) return;
    const m = node.Match || {};
    const court = m.Court?.Name;
    const start: string = m.ScheduledStartDateTime || '';
    if (court && start && m.MatchId != null && !byId.has(m.MatchId)) {
      const date = start.split('T')[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scoreText = (m.Sets || []).filter((s: any) => s.ScoreText).map((s: any) => s.ScoreText).join(', ');
      byId.set(m.MatchId, {
        matchId: m.MatchId, date, start, time: fmtTime(start), court, play: playName,
        team1: teamName(m.FirstTeam?.Name, m.FirstTeamText),
        team2: teamName(m.SecondTeam?.Name, m.SecondTeamText),
        team1Id: m.FirstTeam?.Id ?? null, team2Id: m.SecondTeam?.Id ?? null,
        hasScores: !!m.HasScores, scoreText,
      });
      courts.add(court); days.add(date);
    }
    walkBracket(node.TopSource, playName);
    walkBracket(node.BottomSource, playName);
  };
  for (const plays of playsByDay) {
    if (!Array.isArray(plays)) continue;
    for (const p of plays) {
      if (p.PlayType !== 1) continue;
      for (const r of (p.Roots || [])) walkBracket(r, p.FullName || '');
    }
  }

  // "8:00 AM" sorts wrong as text; sort matches by the raw start instead.
  const matches = [...byId.values()];
  return NextResponse.json({
    event: info.Name || 'Tournament',
    days: [...days].sort(),
    courts: [...courts].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    matches,
  });
}
