import { NextResponse } from 'next/server';
import { aes, generateDateRange, fmtDate, fmtDateLong } from '@/lib/aes';
import type { DayPlays, BracketEntry } from '@/lib/tournament/types';
import { buildPoolStandings } from '@/lib/tournament/standings';
import { buildMatches, buildWorkAssignments } from '@/lib/tournament/matches';
import { buildFinishRanges, buildBracketPaths, normalizePoolKey } from '@/lib/tournament/bracket-paths';
import { buildActiveBracket, buildAllBracketViews } from '@/lib/tournament/active-bracket';
import { buildFinalStandings } from '@/lib/tournament/final-standings';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const teamCode = searchParams.get('team');
  const event = searchParams.get('event');
  const division = searchParams.get('division');

  if (!teamCode || !event || !division) {
    return NextResponse.json({ error: 'Missing required params: team, event, division' }, { status: 400 });
  }

  try {
    // ─── 1. Fetch event metadata ───
    const eventData = await aes(`/api/event/${event}`);
    if (!eventData) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const eventName = eventData.Name || 'Tournament';
    const venue = eventData.Facility?.Name || eventData.Location || '';
    const divisionInfo = (eventData.Divisions || []).find((d: { DivisionId: number }) => String(d.DivisionId) === division);
    const divisionName = divisionInfo?.Name || 'Division';
    const eventDates = generateDateRange(eventData.StartDate, eventData.EndDate);
    const datesDisplay = eventDates.length > 0
      ? `${fmtDateLong(eventDates[0])}${eventDates.length > 1 ? ` - ${fmtDateLong(eventDates[eventDates.length - 1])}` : ''}`
      : '';

    // ─── 2. Fetch plays for ALL days ───
    const allDaysPlays: DayPlays[] = [];
    const playsResults = await Promise.all(
      eventDates.map(date => aes(`/api/event/${event}/division/${division}/plays/${date}`))
    );
    for (let i = 0; i < eventDates.length; i++) {
      if (playsResults[i] && Array.isArray(playsResults[i])) {
        allDaysPlays.push({ date: eventDates[i], plays: playsResults[i] });
      }
    }

    if (allDaysPlays.length === 0) {
      return NextResponse.json({
        error: 'Event data not available yet. The event schedule may not have been published.',
        event: eventName, venue, dates: datesDisplay, division: divisionName,
        fetchedAt: new Date().toISOString(),
        poolName: '', poolCourt: '', poolStandings: [], matches: [],
        workAssignments: [], futurePaths: [], activeBracket: null, finalStandings: [],
      }, { status: 404 });
    }

    // ─── 3. Find our team in the first pool they appear in ───
     
    // Some tournaments re-pool: the team plays in a new pool each day based
    // on the prior day's results. Collect every pool we appear in.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ourPools: { pool: any; day: string }[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ourTeamInfo: any = null;
    // A single pool round can be listed on more than one day's plays (e.g. a
    // pool whose matches span two days). Dedup by pool identity so the same
    // pool isn't collected twice — genuine re-pool rounds keep distinct names.
    const seenPoolKeys = new Set<string>();

    for (const dayData of allDaysPlays) {
      const pools = dayData.plays.filter((p: { PlayType: number }) => p.PlayType === 0);
      for (const pool of pools) {
        const found = (pool.Teams || []).find((t: { TeamCode: string; TeamId: string | number }) => {
          return t.TeamCode?.toLowerCase() === teamCode.toLowerCase() || String(t.TeamId) === teamCode;
        });
        if (found) {
          const poolKey = pool.CompleteFullName || pool.FullName || '';
          if (!seenPoolKeys.has(poolKey)) {
            seenPoolKeys.add(poolKey);
            ourPools.push({ pool, day: dayData.date });
          }
          if (!ourTeamInfo) ourTeamInfo = found;
        }
      }
    }

    if (ourPools.length === 0 || !ourTeamInfo) {
      return NextResponse.json({ error: `Team ${teamCode} not found in this division` }, { status: 404 });
    }

    const ourPool = ourPools[0].pool;
    const ourPoolDay = ourPools[0].day;

    const TEAM_ID = String(ourTeamInfo.TeamId);
    const TEAM_NAME = ourTeamInfo.TeamName;

    // ─── 4. Fetch team-specific schedule ───
    const [current, work, past] = await Promise.all([
      aes(`/api/event/${event}/division/${division}/team/${TEAM_ID}/schedule/current`),
      aes(`/api/event/${event}/division/${division}/team/${TEAM_ID}/schedule/work`),
      aes(`/api/event/${event}/division/${division}/team/${TEAM_ID}/schedule/past`),
    ]);

    // ─── 5. Build all response sections ───
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawTeams: any[] = ourPool.Teams || [];
    const poolStandings = buildPoolStandings(rawTeams, teamCode);

    // One standings table per pool we played in (re-pooling tournaments
    // have more than one)
    const pools = ourPools.map(({ pool, day }) => ({
      poolName: pool.CompleteFullName || pool.FullName,
      poolCourt: pool.Courts?.[0]?.Name || '',
      date: fmtDate(day),
      standings: buildPoolStandings(pool.Teams || [], teamCode),
    }));

    // Map each play name to the day it occurs on — date fallback for
    // matches AES leaves unscheduled (e.g. a final that follows the semis)
    const playDates: Record<string, string> = {};
    for (const dayData of allDaysPlays) {
      for (const play of dayData.plays) {
        if (play.FullName && !playDates[play.FullName]) playDates[play.FullName] = dayData.date;
      }
    }

    const matches = buildMatches(past, current, TEAM_ID, playDates);
    const workAssignments = buildWorkAssignments(work);

    // Predictions seed from the team's LATEST pool — in re-pooling events the
    // final brackets are seeded off the last round, and pool identities are
    // matched by full round/group/pool key (CompleteFullName) to avoid
    // collisions between same-numbered pools in different rounds/groups.
    const seedPoolEntry = ourPools[ourPools.length - 1];
    const seedPool = seedPoolEntry.pool;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seedTeams: any[] = seedPool.Teams || [];
    const poolKey = normalizePoolKey(seedPool.CompleteFullName || seedPool.FullName || '');

    // Collect ALL brackets across all days for lookup
    const allBrackets: BracketEntry[] = [];
    for (const dayData of allDaysPlays) {
      for (const play of dayData.plays) {
        if (play.PlayType === 1) {
          allBrackets.push({ date: dayData.date, play });
        }
      }
    }

    // Use the last day's brackets as the "final" brackets for ranking
    const finalDay = allDaysPlays[allDaysPlays.length - 1];
    const finalBrackets = finalDay ? finalDay.plays.filter((p: { PlayType: number }) => p.PlayType === 1) : [];
    const { bracketFinishRanges, totalTeams } = buildFinishRanges(finalBrackets);

    const { futurePaths, chainedPaths, bracketCards } = buildBracketPaths({
      allBrackets,
      allDaysPlays,
      rawTeams: seedTeams,
      teamCode,
      teamName: TEAM_NAME,
      poolKey,
      bracketFinishRanges,
    });

    const activeBracket = buildActiveBracket({ current, past, allDaysPlays, teamCode, bracketFinishRanges });
    // Scored view for every bracket (keyed by name), so non-Gold brackets
    // render the same way once their teams are slotted
    const activeBrackets = buildAllBracketViews({ brackets: allBrackets, teamCode, bracketFinishRanges });
    const finalStandings = buildFinalStandings(finalDay, TEAM_NAME);

    // Whether the event's last day has passed — lets the UI distinguish
    // "no scores yet" from "never played"
    const lastDate = eventDates[eventDates.length - 1];
    const eventComplete = lastDate ? new Date(`${lastDate}T23:59:59`) < new Date() : false;

    // ─── Return response ───
    return NextResponse.json({
      team: TEAM_NAME,
      teamCode,
      teamId: TEAM_ID,
      event: eventName,
      venue,
      dates: datesDisplay,
      division: divisionName,
      fetchedAt: new Date().toISOString(),
      poolName: ourPool.CompleteFullName || ourPool.FullName,
      poolCourt: ourPool.Courts?.[0]?.Name || '',
      poolStandings,
      pools,
      matches,
      workAssignments,
      futurePaths,
      chainedPaths,
      bracketCards,
      activeBracket,
      activeBrackets,
      finalStandings,
      totalTeams,
      eventComplete,
      buildId: process.env.NEXT_PUBLIC_BUILD_ID || '',
      debug: {
        eventDates,
        daysWithData: allDaysPlays.map(d => d.date),
        totalBrackets: allBrackets.length,
        ourPoolDay,
      },
    });

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
