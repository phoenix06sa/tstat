import { NextResponse } from 'next/server';

const BASE = 'https://results.advancedeventsystems.com';
const EVENT = 'PTAwMDAwNDEyNDA90';
const DIV = '195174';

const AES_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'origin': 'https://results.advancedeventsystems.com',
  'referer': 'https://results.advancedeventsystems.com/',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function aes(path: string): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await fetch(`${BASE}${path}`, { headers: AES_HEADERS, next: { revalidate: 60 } } as any);
  if (!res.ok) return null;
  return res.json();
}

function fmtTime(iso: string) {
  if (!iso) return '';
  const [, time] = iso.split('T');
  const [h, m] = time.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function fmtDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractAllSources(play: any): Set<string> {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveOpponent(opponentPoolTeams: any[], wantRank: number): string {
  const sorted = [...opponentPoolTeams].sort((a, b) => {
    if (a.FinishRank !== null && b.FinishRank !== null) return a.FinishRank - b.FinishRank;
    if (a.FinishRank !== null) return -1;
    if (b.FinishRank !== null) return 1;
    return b.MatchesWon - a.MatchesWon;
  });
  const team = sorted[wantRank - 1];
  if (!team) return `${wantRank === 1 ? '1st' : '2nd'} place (TBD)`;
  const isResolved = team.FinishRank !== null || team.MatchesWon > 0;
  if (!isResolved) return `${wantRank === 1 ? '1st' : '2nd'} place from opponent pool (TBD)`;
  const label = team.FinishRank !== null ? `confirmed ${wantRank === 1 ? '1st' : '2nd'}` : `leading ${wantRank === 1 ? '1st' : '2nd'}`;
  return `${team.TeamName} (${label})`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const teamCode = searchParams.get('team') || 'g14askyl2ls';

  try {
    const [day1, day2] = await Promise.all([
      aes(`/api/event/${EVENT}/division/${DIV}/plays/2026-05-09`),
      aes(`/api/event/${EVENT}/division/${DIV}/plays/2026-05-10`),
    ]);

    // --- Find the team's pool ---
    const pools = day1.filter((p: { PlayType: number }) => p.PlayType === 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ourPool: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ourTeamInfo: any = null;

    for (const pool of pools) {
      const found = (pool.Teams || []).find((t: { TeamCode: string }) =>
        t.TeamCode?.toLowerCase() === teamCode.toLowerCase()
      );
      if (found) { ourPool = pool; ourTeamInfo = found; break; }
    }

    if (!ourPool || !ourTeamInfo) {
      return NextResponse.json({ error: `Team ${teamCode} not found in this division` }, { status: 404 });
    }

    const TEAM_ID = String(ourTeamInfo.TeamId);
    const TEAM_NAME = ourTeamInfo.TeamName;
    const poolShortName = ourPool.ShortName || ourPool.FullName; // e.g. "P5"
    const poolNumber = ourPool.FullName.replace('Pool ', ''); // e.g. "5"

    // --- Fetch team-specific schedule ---
    const [current, work, future, past] = await Promise.all([
      aes(`/api/event/${EVENT}/division/${DIV}/team/${TEAM_ID}/schedule/current`),
      aes(`/api/event/${EVENT}/division/${DIV}/team/${TEAM_ID}/schedule/work`),
      aes(`/api/event/${EVENT}/division/${DIV}/team/${TEAM_ID}/schedule/future`),
      aes(`/api/event/${EVENT}/division/${DIV}/team/${TEAM_ID}/schedule/past`),
    ]);

    // --- Pool standings ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poolStandings = (ourPool.Teams || []).map((t: any) => ({
      teamName: t.TeamName,
      teamCode: t.TeamCode,
      isUs: t.TeamCode?.toLowerCase() === teamCode.toLowerCase(),
      matchesWon: t.MatchesWon,
      matchesLost: t.MatchesLost,
      setsWon: t.SetsWon,
      setsLost: t.SetsLost,
      matchPct: t.MatchPercent,
      finishRank: t.FinishRank,
      overallRank: t.OverallRank,
    }));

    // --- Pool play matches: combine past (completed) + current pool play (upcoming) ---
    // After pool play ends, /schedule/current only shows bracket matches.
    // /schedule/past has all completed matches. We merge both and deduplicate by matchId.
    const poolMatches: object[] = [];
    const seenMatchIds = new Set<number>();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addMatch = (m: any, playType: number, iFirst: boolean) => {
      const matchId = m.MatchId || m.matchId;
      if (seenMatchIds.has(matchId)) return;
      seenMatchIds.add(matchId);
      const opponent = iFirst ? m.SecondTeamName : m.FirstTeamName;
      const opponentCode = iFirst ? m.SecondTeamCode : m.FirstTeamCode;
      const ourWon = iFirst ? m.FirstTeamWon : m.SecondTeamWon;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sets = (m.Sets || []).map((s: any) => ({
        us: iFirst ? s.FirstTeamScore : s.SecondTeamScore,
        them: iFirst ? s.SecondTeamScore : s.FirstTeamScore,
      }));
      poolMatches.push({
        matchName: m.MatchFullName,
        time: fmtTime(m.ScheduledStartDateTime),
        date: fmtDate(m.ScheduledStartDateTime),
        court: m.Court?.Name,
        opponent,
        opponentCode,
        workTeam: m.WorkTeamText,
        hasScores: m.HasScores,
        sets,
        weWon: m.HasScores ? ourWon : null,
        isPoolPlay: playType === 0,
      });
    }

    // Past matches (completed)
    if (past) {
      for (const block of past) {
        const m = block.Match;
        if (!m) continue;
        const playType = block.Play?.Type ?? block.PlayType ?? 0;
        const iFirst = m.FirstTeamId === Number(TEAM_ID);
        addMatch(m, playType, iFirst);
      }
    }

    // Current matches (upcoming/in-progress)
    if (current) {
      for (const block of current) {
        const playType = block.Play?.Type ?? 0;
        for (const m of (block.Matches || [])) {
          const iFirst = m.FirstTeamId === Number(TEAM_ID);
          addMatch(m, playType, iFirst);
        }
      }
    }

    // --- Work assignments ---
    const workAssignments: object[] = [];
    if (work) {
      for (const block of work) {
        workAssignments.push({
          play: block.Play?.FullName,
          time: fmtTime(block.Match?.ScheduledStartDateTime),
          date: fmtDate(block.Match?.ScheduledStartDateTime),
          court: block.Match?.Court?.Name,
        });
      }
    }

    // --- Discover opponent pool and bracket paths from Saturday data ---
    // future API gives 1st/2nd paths; extract bracket names and find opponent pools dynamically
    const brackets_sat = day1.filter((p: { PlayType: number }) => p.PlayType === 1);

    // Build bracket-to-opponent-pool map
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bracketOpponentPoolMap: Record<string, any> = {};
    for (const pool of pools) {
      const teams = pool.Teams || [];
      if (!teams.length) continue;
      const tid = teams[0].TeamId;
      const pFuture = await aes(`/api/event/${EVENT}/division/${DIV}/team/${tid}/schedule/future`);
      if (!pFuture) continue;
      for (const f of pFuture) {
        const brktName = f.NextPlay?.FullName;
        const rank = f.PotentialRank;
        if (!bracketOpponentPoolMap[brktName]) bracketOpponentPoolMap[brktName] = {};
        bracketOpponentPoolMap[brktName][rank] = pool;
      }
    }

    // --- Find 3rd/4th Sunday bracket info dynamically ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const findSundayBracketForTag = (tag: string): { bracketName: string; court: string; time: string; workCourt: string; workTime: string } | null => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const findMatchWithTag = (node: any): any => {
        if (!node) return null;
        const m = node.Match || {};
        if (m.FirstTeamText === tag || m.SecondTeamText === tag) return m;
        return findMatchWithTag(node.TopSource) || findMatchWithTag(node.BottomSource);
      };
      for (const b of day2) {
        if (!b || typeof b !== 'object') continue;
        const sources = extractAllSources(b);
        if (!sources.has(tag)) continue;
        for (const r of (b.Roots || [])) {
          const m = findMatchWithTag(r.TopSource) || findMatchWithTag(r.BottomSource);
          if (m) {
            const rootM = r.Match || {};
            return {
              bracketName: b.FullName,
              court: m.Court?.Name || rootM.Court?.Name || '',
              time: fmtTime(m.ScheduledStartDateTime || rootM.ScheduledStartDateTime),
              workCourt: rootM.Court?.Name || '',
              workTime: fmtTime(rootM.ScheduledStartDateTime),
            };
          }
        }
        return { bracketName: b.FullName, court: '', time: '', workCourt: '', workTime: '' };
      }
      return null;
    };

    // --- Discover Sunday bracket placement for winner/loser of our challenge brackets ---
    const findSundayForChBrkt = (brktShortName: string, outcome: 'Winner' | 'Loser'): { bracketName: string; teamCount: number } | null => {
      const tag = `${outcome} of ${brktShortName}M1`;
      for (const b of day2) {
        if (!b || typeof b !== 'object') continue;
        const sources = extractAllSources(b);
        if (sources.has(tag)) {
          const teamCount = sources.size;
          return { bracketName: b.FullName, teamCount };
        }
      }
      return null;
    };

    // --- Build future paths ---
    const futurePaths: object[] = [];

    if (future) {
      for (const f of future) {
        const brktName = f.NextPlay?.FullName; // e.g. "Challenge Bracket #5"
        const brktShortName = f.NextPlay?.ShortName; // e.g. "ChBrkt#5"
        const rank = f.PotentialRank; // 1 or 2

        // Opponent pool: the OTHER pool that feeds into this bracket
        const brktPools = bracketOpponentPoolMap[brktName] || {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const opponentPool: any = Object.entries(brktPools).find(([r, p]: [string, any]) =>
          Number(r) !== rank && (p as any).FullName !== ourPool.FullName
        )?.[1];
        const opponentPoolTeams = opponentPool?.Teams || [];
        const opponentWantRank = rank === 1
          ? Object.keys(brktPools).find(r => Number(r) !== 1 && brktPools[r].FullName !== ourPool.FullName) ? 2 : 1
          : 1;
        const opponentResolved = resolveOpponent(opponentPoolTeams, opponentWantRank);
        const opponentPoolLabel = opponentPool
          ? `${opponentPool.FullName} (${opponentPool.Courts?.[0]?.Name || ''}): ${opponentPoolTeams.map((t: { TeamName: string }) => t.TeamName).join(' · ')}`
          : 'Opponent pool TBD';

        // Where does winner/loser go on Sunday?
        const winnerSunday = findSundayForChBrkt(brktShortName, 'Winner');
        const loserSunday = findSundayForChBrkt(brktShortName, 'Loser');

        const finishRange = [
          winnerSunday ? `Win -> ${winnerSunday.bracketName} (top bracket)` : 'Win -> TBD',
          loserSunday ? `Lose -> ${loserSunday.bracketName} (mid-tier)` : 'Lose -> TBD',
        ].join('\n');

        futurePaths.push({
          finishText: f.PotentialRankText,
          rank,
          nextPlay: f.NextPlay?.CompleteFullName,
          nextPlayShort: brktName,
          court: f.NextMatch?.Court?.Name,
          time: fmtTime(f.NextMatch?.ScheduledStartDateTime),
          workCourt: f.WorkMatch?.Court?.Name,
          workTime: fmtTime(f.WorkMatch?.ScheduledStartDateTime),
          saturdayEvening: true,
          opponentResolved,
          opponentPoolLabel,
          finishRange,
        });
      }
    }

    // 3rd and 4th — find dynamically from Sunday bracket source tags
    const thirdTag = `3rd-P${poolNumber}`;
    const fourthTag = `4th-P${poolNumber}`;
    const thirdInfo = findSundayBracketForTag(thirdTag);
    const fourthInfo = findSundayBracketForTag(fourthTag);

    if (thirdInfo) {
      futurePaths.push({
        finishText: `3rd-P${poolNumber}`,
        rank: 3,
        nextPlay: `Round 3 Group 1 ${thirdInfo.bracketName} (Sunday)`,
        nextPlayShort: thirdInfo.bracketName,
        court: thirdInfo.court,
        time: thirdInfo.time,
        workCourt: thirdInfo.workCourt,
        workTime: thirdInfo.workTime,
        saturdayEvening: false,
        note: 'No Saturday evening match — straight to Sunday bracket',
        finishRange: `4 teams · ${thirdInfo.bracketName}`,
      });
    }
    if (fourthInfo) {
      futurePaths.push({
        finishText: `4th-P${poolNumber}`,
        rank: 4,
        nextPlay: `Round 3 Group 1 ${fourthInfo.bracketName} (Sunday)`,
        nextPlayShort: fourthInfo.bracketName,
        court: fourthInfo.court,
        time: fourthInfo.time,
        workCourt: fourthInfo.workCourt,
        workTime: fourthInfo.workTime,
        saturdayEvening: false,
        note: 'No Saturday evening match — straight to Sunday bracket',
        finishRange: `4 teams · ${fourthInfo.bracketName}`,
      });
    }

    // --- Sunday bracket info ---
    const sundayBrackets: object[] = [];
    if (day2) {
      for (const play of day2) {
        if (!play || typeof play !== 'object') continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const teams = (play.Teams || []).map((t: any) => ({
          teamName: t.TeamName,
          teamCode: t.TeamCode,
          isUs: t.TeamCode?.toLowerCase() === teamCode.toLowerCase(),
          finishRank: t.FinishRank,
        }));
        sundayBrackets.push({
          name: play.CompleteFullName || play.FullName,
          shortName: play.FullName,
          courts: (play.Courts || []).map((c: { Name: string }) => c.Name),
          teams,
          hasTeams: teams.length > 0,
          weAreIn: teams.some((t: { isUs: boolean }) => t.isUs),
        });
      }
    }

    return NextResponse.json({
      team: TEAM_NAME,
      teamCode,
      teamId: TEAM_ID,
      event: '2026 Lone Star Regionals (12-14s)',
      venue: 'George R. Brown Convention Center',
      dates: 'May 9-10, 2026',
      division: '14 Bid',
      fetchedAt: new Date().toISOString(),
      poolName: ourPool.CompleteFullName || ourPool.FullName,
      poolCourt: ourPool.Courts?.[0]?.Name || '',
      poolStandings,
      poolMatches,
      workAssignments,
      futurePaths,
      sundayBrackets,
    });

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
