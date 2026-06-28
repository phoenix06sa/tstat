import { NextResponse } from 'next/server';
import { aes, generateDateRange, fmtTime, stripAllSuffixes } from '@/lib/aes';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Per-court, per-day match schedule across the WHOLE event (all divisions): pick
// a day + court, see the time-ordered matches (both teams, times). AES has no
// event-level schedule endpoint, so:
//   - Bracket matches (every division): from each division's plays endpoint —
//     they carry court + time + both teams. Cheap enough across all divisions.
//   - Pool matches: only the plays *standings*, not the match grid. Those come
//     from team schedules, which is infeasible for every team in every division,
//     so pool matches are limited to OUR division (aggregated from its teams).
// Each match is tagged with its division so cross-division courts read clearly.

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

type Row = {
  matchId: number; date: string; start: string; time: string; court: string;
  division: string; play: string; team1: string; team2: string;
  team1Id: number | null; team2Id: number | null; hasScores: boolean; scoreText: string;
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const event = searchParams.get('event');
  const division = searchParams.get('division');
  if (!event || !division) {
    return NextResponse.json({ error: 'Missing required params: event, division' }, { status: 400 });
  }

  const info = await aes(`/api/event/${event}`, 60);
  if (!info) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  const divisions: { id: string; name: string }[] = (info.Divisions || [])
    .map((d: { DivisionId: number; Name: string }) => ({ id: String(d.DivisionId), name: d.Name }));
  const ourDivName = divisions.find(d => d.id === division)?.name || 'Division';
  const dates = info.StartDate && info.EndDate ? generateDateRange(info.StartDate, info.EndDate) : [];

  const byId = new Map<number, Row>();
  const courts = new Set<string>();
  const days = new Set<string>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addRow = (m: any, divName: string, play: string, team1: string, team2: string, t1Id: number | null, t2Id: number | null) => {
    const court = m.Court?.Name;
    const start: string = m.ScheduledStartDateTime || '';
    if (!court || !start || m.MatchId == null || byId.has(m.MatchId)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scoreText = (m.Sets || []).filter((s: any) => s.ScoreText).map((s: any) => s.ScoreText).join(', ');
    byId.set(m.MatchId, {
      matchId: m.MatchId, date: start.split('T')[0], start, time: fmtTime(start), court,
      division: divName, play, team1, team2, team1Id: t1Id, team2Id: t2Id,
      hasScores: !!m.HasScores, scoreText,
    });
    courts.add(court); days.add(start.split('T')[0]);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walkBracket = (node: any, divName: string, play: string) => {
    if (!node) return;
    const m = node.Match || {};
    addRow(m, divName, play, teamName(m.FirstTeam?.Name, m.FirstTeamText), teamName(m.SecondTeam?.Name, m.SecondTeamText), m.FirstTeam?.Id ?? null, m.SecondTeam?.Id ?? null);
    walkBracket(node.TopSource, divName, play);
    walkBracket(node.BottomSource, divName, play);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addBrackets = (plays: any, divName: string) => {
    if (!Array.isArray(plays)) return;
    for (const p of plays) {
      if (p.PlayType !== 1) continue;
      for (const r of (p.Roots || [])) walkBracket(r, divName, p.FullName || '');
    }
  };

  // ── Our division's plays: brackets + team ids for the pool aggregation ──
  const ourPlaysByDay = await Promise.all(dates.map(d => aes(`/api/event/${event}/division/${division}/plays/${d}`, 60)));
  // Only bracket days matter for the other divisions (their pool matches aren't
  // reachable anyway), so fetch them only where brackets exist — keeps the
  // request count down on big events.
  const bracketDates: string[] = [];
  const teamIds = new Set<string>();
  for (let i = 0; i < dates.length; i++) {
    const plays = ourPlaysByDay[i];
    if (!Array.isArray(plays) || plays.length === 0) continue;
    addBrackets(plays, ourDivName);
    if (plays.some((p: { PlayType: number }) => p.PlayType === 1)) bracketDates.push(dates[i]);
    for (const p of plays) {
      if (p.PlayType !== 0) continue;
      for (const t of (p.Teams || [])) if (t.TeamId != null) teamIds.add(String(t.TeamId));
    }
  }

  // ── Every other division's brackets, on the bracket days ──
  const otherReqs: { id: string; name: string; date: string }[] = [];
  for (const d of divisions) {
    if (d.id === division) continue;
    for (const date of bracketDates) otherReqs.push({ id: d.id, name: d.name, date });
  }
  const otherPlays = await chunked(otherReqs, 24, r =>
    aes(`/api/event/${event}/division/${r.id}/plays/${r.date}`, 60).then(p => ({ p, name: r.name })));
  for (const { p, name } of otherPlays) addBrackets(p, name);

  // ── Our division's pool matches, from each team's schedule ──
  const schedReqs: { tid: string; kind: 'past' | 'current' }[] = [];
  for (const tid of teamIds) { schedReqs.push({ tid, kind: 'past' }); schedReqs.push({ tid, kind: 'current' }); }
  const schedules = await chunked(schedReqs, 24, r =>
    aes(`/api/event/${event}/division/${division}/team/${r.tid}/schedule/${r.kind}`, 60));
  for (const sched of schedules) {
    if (!Array.isArray(sched)) continue;
    for (const entry of sched) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const matches: any[] = entry.Matches || (entry.Match ? [entry.Match] : []);
      const play = entry.Play?.FullName || '';
      for (const m of matches) addRow(m, ourDivName, play, teamName(m.FirstTeamName, m.FirstTeamText), teamName(m.SecondTeamName, m.SecondTeamText), m.FirstTeamId ?? null, m.SecondTeamId ?? null);
    }
  }

  return NextResponse.json({
    event: info.Name || 'Tournament',
    days: [...days].sort(),
    courts: [...courts].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    matches: [...byId.values()],
  });
}
