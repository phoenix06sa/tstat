import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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
  if (!res.ok || res.status === 204) return null;
  const text = await res.text();
  if (!text || text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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

    // --- Pool standings with tiebreaker explanation ---
    // Compute tiebreaker reason for any teams tied on match record
    // AES tiebreaker order: 1) Match %, 2) Set %, 3) Point ratio
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawTeams: any[] = ourPool.Teams || [];

    // Group by match record to find who was tied
    const matchRecordGroups: Record<string, typeof rawTeams> = {};
    for (const t of rawTeams) {
      const key = `${t.MatchesWon}-${t.MatchesLost}`;
      if (!matchRecordGroups[key]) matchRecordGroups[key] = [];
      matchRecordGroups[key].push(t);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiebreakers: Record<string, string> = {};
    for (const [record, group] of Object.entries(matchRecordGroups)) {
      if (group.length < 2) continue;
      // Check what broke the tie
      const setPercs = group.map((t: { TeamCode: string; SetPercent: number }) => t.SetPercent);
      const allSameSetPerc = setPercs.every((v: number) => v === setPercs[0]);
      for (const t of group) {
        if (!allSameSetPerc) {
          tiebreakers[t.TeamCode] = `Tied ${record} on matches, advanced by set % (${(t.SetPercent * 100).toFixed(1)}%)`;
        } else {
          tiebreakers[t.TeamCode] = `Tied ${record} on matches + sets, advanced by point ratio (${t.PointRatio.toFixed(3)})`;
        }
      }
    }

    const poolStandings = rawTeams.map((t: { TeamCode: string; TeamName: string; MatchesWon: number; MatchesLost: number; SetsWon: number; SetsLost: number; SetPercent: number; PointRatio: number; MatchPercent: string; FinishRank: number | null; OverallRank: number | null; FinishRankText: string }) => ({
      teamName: t.TeamName,
      teamCode: t.TeamCode,
      isUs: t.TeamCode?.toLowerCase() === teamCode.toLowerCase(),
      matchesWon: t.MatchesWon,
      matchesLost: t.MatchesLost,
      setsWon: t.SetsWon,
      setsLost: t.SetsLost,
      matchPct: t.MatchPercent,
      setPercent: t.SetPercent,
      pointRatio: t.PointRatio,
      finishRank: t.FinishRank,
      overallRank: t.OverallRank,
      finishRankText: t.FinishRankText,
      tiebreaker: tiebreakers[t.TeamCode] || null,
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
    const brackets_sat = day1.filter((p: { PlayType: number }) => p.PlayType === 1);
    // Note: bracketOpponentPoolMap (which required 16 API calls) has been removed.
    // We now find our pool's brackets directly from the Saturday bracket Roots by TeamCode.

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

    // --- Build Sunday bracket finish range map ---
    // 64 teams total. Brackets in order: Gold(16), Silver A-D(4 each=16), Bronze A-D(4 each=16), Flight 1A-1D(4 each=16)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sundayFinishRanges: Record<string, { best: string; worst: string; note: string }> = {
      'Gold Bracket':     { best: '1st',  worst: '16th', note: '16 teams — all Saturday bracket winners' },
      // Silver A-D are the same tier: ranks 17-32 combined (4 brackets × 4 teams)
      // No 3rd place match within each Silver bracket — semi-losers share 3rd/4th in bracket
      'Silver A Bracket': { best: '17th', worst: '32nd', note: '4 teams — Saturday bracket losers. Win final ~17th, lose final ~21st, lose semi ~25th–32nd' },
      'Silver B Bracket': { best: '17th', worst: '32nd', note: '4 teams — Saturday bracket losers. Win final ~17th, lose final ~21st, lose semi ~25th–32nd' },
      'Silver C Bracket': { best: '17th', worst: '32nd', note: '4 teams — Saturday bracket losers. Win final ~17th, lose final ~21st, lose semi ~25th–32nd' },
      'Silver D Bracket': { best: '17th', worst: '32nd', note: '4 teams — Saturday bracket losers. Win final ~17th, lose final ~21st, lose semi ~25th–32nd' },
      'Bronze A Bracket': { best: '33rd', worst: '48th', note: '4 teams — 3rd place pool finishers' },
      'Bronze B Bracket': { best: '33rd', worst: '48th', note: '4 teams — 3rd place pool finishers' },
      'Bronze C Bracket': { best: '33rd', worst: '48th', note: '4 teams — 3rd place pool finishers' },
      'Bronze D Bracket': { best: '33rd', worst: '48th', note: '4 teams — 3rd place pool finishers' },
      'Flight 1A Bracket': { best: '49th', worst: '64th', note: '4 teams — 4th place pool finishers' },
      'Flight 1B Bracket': { best: '49th', worst: '64th', note: '4 teams — 4th place pool finishers' },
      'Flight 1C Bracket': { best: '49th', worst: '64th', note: '4 teams — 4th place pool finishers' },
      'Flight 1D Bracket': { best: '49th', worst: '64th', note: '4 teams — 4th place pool finishers' },
    };
    // We always show all 4 paths based on pool finish, regardless of which play we're in now.
    // 1st/2nd go to Saturday evening challenge brackets -> then Sunday Gold/Silver
    // 3rd/4th skip Saturday evening -> directly to Sunday Bronze/Flight
    //
    // Strategy:
    // - 1st/2nd: use bracketOpponentPoolMap to find the challenge bracket + opponent
    //   and findSundayForChBrkt to find Sunday destination
    // - 3rd/4th: pool standings now have finishRank. Find those actual teams and
    //   search day2 by team name (AES replaces "3rd-P5" tags with real names post-pool)

    const futurePaths: object[] = [];

    // Get sorted pool standings for rank lookup
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sortedStandings = [...rawTeams].sort((a: any, b: any) => (a.FinishRank ?? 99) - (b.FinishRank ?? 99));

    // Find which challenge bracket our pool feeds at rank 1 and 2
    // Look at the Saturday bracket data. After pool play, AES replaces seed text with real teams.
    // Match by TeamCode in FirstTeam.Code / SecondTeam.Code
    const ourPoolChBrkts: Record<number, string> = {}; // rank -> bracketName
    const satBrackets = day1.filter((p: { PlayType: number }) => p.PlayType === 1);
    // Build a map of teamCode -> bracket + slot (1=first, 2=second)
    for (const brkt of satBrackets) {
      for (const root of (brkt.Roots || [])) {
        const m = root.Match || {};
        const firstCode: string = m.FirstTeam?.Code || '';
        const secondCode: string = m.SecondTeam?.Code || '';
        // Check if any of our pool teams are in this bracket
        for (const t of rawTeams) {
          const tc: string = t.TeamCode?.toLowerCase() || '';
          if (firstCode.toLowerCase() === tc || secondCode.toLowerCase() === tc) {
            // This bracket contains one of our pool's teams -> find their pool rank
            const rank = t.FinishRank;
            if (rank && rank <= 2) {
              ourPoolChBrkts[rank] = brkt.FullName;
            }
          }
        }
      }
    }

    // Helper: find which Sunday bracket contains a specific team name text
    const findSundayForTeamText = (teamText: string): { bracketName: string; court: string; time: string; workCourt: string; workTime: string } | null => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const findMatchWithTeam = (node: any): any => {
        if (!node) return null;
        const m = node.Match || {};
        if (m.FirstTeamText === teamText || m.SecondTeamText === teamText) return { match: m, rootMatch: null };
        return findMatchWithTeam(node.TopSource) || findMatchWithTeam(node.BottomSource);
      };
      for (const b of day2) {
        if (!b || typeof b !== 'object') continue;
        const sources = extractAllSources(b);
        if (!sources.has(teamText)) continue;
        for (const r of (b.Roots || [])) {
          const result = findMatchWithTeam(r.TopSource) || findMatchWithTeam(r.BottomSource);
          if (result) {
            const m = result.match;
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

    // Build paths for all 4 pool finish ranks
    for (let poolRank = 1; poolRank <= 4; poolRank++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const teamAtRank: any = sortedStandings[poolRank - 1];
      const isUs = teamAtRank?.TeamCode?.toLowerCase() === teamCode.toLowerCase();
      const rankText = teamAtRank?.FinishRankText || `${poolRank}${poolRank === 1 ? 'st' : poolRank === 2 ? 'nd' : poolRank === 3 ? 'rd' : 'th'}`;
      const finishText = `${rankText}-P${poolNumber}`;

      if (poolRank <= 2) {
        // Saturday evening challenge bracket path
        // After pool play, future API returns Sunday bracket directly (Gold/Silver)
        // But we still need the challenge bracket as the intermediate step.
        // Use the future API for timing and Sunday destination; derive ChBrkt name from ourPoolChBrkts
        const brktName = ourPoolChBrkts[poolRank];
        const brktShortName = brktName?.replace('Challenge Bracket #', 'ChBrkt#') || '';

        // Get real match details from Saturday bracket data
        const brktPlay = satBrackets.find((b: { FullName: string }) => b.FullName === brktName);
        const brktMatch = brktPlay?.Roots?.[0]?.Match;
        const iFirst = brktMatch?.FirstTeam?.Code?.toLowerCase() === teamCode.toLowerCase()
          || brktMatch?.SecondTeam?.Code?.toLowerCase() !== teamCode.toLowerCase();

        // Real opponent from bracket match data
        let opponentResolved = '';
        let opponentPoolLabel = '';

        // Use actual team data from bracket if available
        if (brktMatch?.FirstTeam && brktMatch?.SecondTeam) {
          const teamIsFirst = brktMatch.FirstTeam.Code?.toLowerCase() === teamAtRank?.TeamCode?.toLowerCase();
          const oppTeam = teamIsFirst ? brktMatch.SecondTeam : brktMatch.FirstTeam;
          opponentResolved = `${oppTeam.Name} (${oppTeam.Code})`;
        }

        // Also get scores/result if bracket match has been played
        const brktHasScores = brktMatch?.HasScores || false;
        const brktFirstWon = brktMatch?.FirstTeamWon || false;
        const brktSecondWon = brktMatch?.SecondTeamWon || false;
        const teamIsFirst = brktMatch?.FirstTeam?.Code?.toLowerCase() === teamAtRank?.TeamCode?.toLowerCase();
        const weWon = brktHasScores ? (teamIsFirst ? brktFirstWon : brktSecondWon) : null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const brktSets = (brktMatch?.Sets || []).map((s: any) => ({
          us: teamIsFirst ? s.FirstTeamScore : s.SecondTeamScore,
          them: teamIsFirst ? s.SecondTeamScore : s.FirstTeamScore,
        }));
        // Sunday destinations — try ChBrkt tag first, fall back to team name search
        const winnerSunday = findSundayForChBrkt(brktShortName, 'Winner')
          || (() => {
            // After bracket play, tags replaced with team names — find by winner's team text
            if (brktMatch?.FirstTeam && brktMatch?.SecondTeam && brktHasScores) {
              const winnerTeam = brktMatch.FirstTeamWon ? brktMatch.FirstTeam : brktMatch.SecondTeam;
              const winnerText = `${winnerTeam.Name} (LS)`;
              for (const b of day2) {
                if (!b || typeof b !== 'object') continue;
                const sources = extractAllSources(b);
                if (sources.has(winnerText)) return { bracketName: b.FullName, teamCount: 0 };
              }
            }
            return null;
          })();

        const loserSunday = findSundayForChBrkt(brktShortName, 'Loser')
          || (() => {
            if (brktMatch?.FirstTeam && brktMatch?.SecondTeam && brktHasScores) {
              const loserTeam = brktMatch.FirstTeamWon ? brktMatch.SecondTeam : brktMatch.FirstTeam;
              const loserText = `${loserTeam.Name} (LS)`;
              for (const b of day2) {
                if (!b || typeof b !== 'object') continue;
                const sources = extractAllSources(b);
                if (sources.has(loserText)) return { bracketName: b.FullName, teamCount: 0 };
              }
            }
            return null;
          })();

        const winRange = winnerSunday ? sundayFinishRanges[winnerSunday.bracketName] : null;
        const loseRange = loserSunday ? sundayFinishRanges[loserSunday.bracketName] : null;

        // If bracket is already played, show actual result with destination
        let finishRange: string;
        if (brktHasScores && winnerSunday && loserSunday) {
          const wonLine = `Win → ${winnerSunday.bracketName}${winRange ? ` · best ${winRange.best}, worst ${winRange.worst} of 64` : ''}`;
          const lostLine = `Lose → ${loserSunday.bracketName}${loseRange ? ` · best ${loseRange.best}, worst ${loseRange.worst} of 64` : ''}`;
          finishRange = [wonLine, lostLine].join('\n');
        } else {
          finishRange = [
            winnerSunday
              ? `Win → ${winnerSunday.bracketName} · best ${winRange?.best ?? '?'}, worst ${winRange?.worst ?? '?'} of 64`
              : 'Win → TBD',
            loserSunday
              ? `Lose → ${loserSunday.bracketName} · best ${loseRange?.best ?? '?'}, worst ${loseRange?.worst ?? '?'} of 64`
              : 'Lose → TBD',
          ].join('\n');
        }

        // Get match time/court from current bracket match or future API
        let court = '', time = '', workCourt = '', workTime = '';
        // First try: live current bracket match (most accurate)
        if (current) {
          for (const block of current) {
            if (block.Play?.FullName === brktName || block.Play?.ShortName === brktShortName) {
              const m = block.Matches?.[0];
              if (m) {
                court = m.Court?.Name || '';
                time = fmtTime(m.ScheduledStartDateTime);
                workCourt = m.Court?.Name || ''; // work is after on same court
                workTime = ''; // not directly available from current
              }
            }
          }
        }
        // Second try: future API — rank 1 always maps to index 0, rank 2 to index 1
        if (!court && future && future.length >= poolRank) {
          const fEntry = future[poolRank - 1];
          // Note: after pool play future returns Sunday times, not Saturday bracket
          // So fall back to bracketOpponentPoolMap for the Saturday time
          // Use the challenge bracket play from day1 directly
          const brktPlay = satBrackets.find((b: { FullName: string }) => b.FullName === brktName);
          if (brktPlay?.Roots?.[0]?.Match) {
            const bm = brktPlay.Roots[0].Match;
            court = bm.Court?.Name || '';
            time = fmtTime(bm.ScheduledStartDateTime);
            // Work assignment is in the /schedule/work endpoint, approximate from fEntry
            workCourt = fEntry?.WorkMatch?.Court?.Name || court;
            workTime = fmtTime(fEntry?.WorkMatch?.ScheduledStartDateTime);
          }
        }

        futurePaths.push({
          finishText,
          rank: poolRank,
          isUs,
          teamAtRank: teamAtRank?.TeamName || '',
          nextPlay: `Round 2 Group 1 ${brktName}`,
          nextPlayShort: brktName || 'Challenge Bracket',
          court,
          time,
          workCourt,
          workTime,
          saturdayEvening: true,
          opponentResolved,
          opponentPoolLabel,
          finishRange,
          hasScores: brktHasScores,
          weWon,
          sets: brktSets,
        });

      } else {
        // 3rd/4th — no Saturday evening match, straight to Sunday
        // Find their Sunday bracket by their team text
        const teamText = teamAtRank ? `${teamAtRank.TeamName} (LS)` : '';
        const sundayInfo = teamText ? findSundayForTeamText(teamText) : null;

        // Find their first match opponent from Sunday bracket source data
        let sundayOpponent = '';
        if (teamText) {
          for (const b of day2) {
            if (!b || typeof b !== 'object') continue;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const findOppInNode = (node: any): string => {
              if (!node) return '';
              const m = node.Match || {};
              const t1: string = m.FirstTeamText || '';
              const t2: string = m.SecondTeamText || '';
              if (t1 === teamText && t2) return t2.replace(' (LS)', '');
              if (t2 === teamText && t1) return t1.replace(' (LS)', '');
              return findOppInNode(node.TopSource) || findOppInNode(node.BottomSource);
            };
            for (const r of (b.Roots || [])) {
              const opp = findOppInNode(r.TopSource) || findOppInNode(r.BottomSource);
              if (opp) { sundayOpponent = opp; break; }
            }
            if (sundayOpponent) break;
          }
        }

        futurePaths.push({
          finishText,
          rank: poolRank,
          isUs,
          teamAtRank: teamAtRank?.TeamName || '',
          nextPlay: sundayInfo ? `Round 3 Group 1 ${sundayInfo.bracketName} (Sunday)` : 'Sunday bracket TBD',
          nextPlayShort: sundayInfo?.bracketName || 'TBD',
          court: sundayInfo?.court || '',
          time: sundayInfo?.time || '',
          workCourt: sundayInfo?.workCourt || '',
          workTime: sundayInfo?.workTime || '',
          saturdayEvening: false,
          note: 'No Saturday evening match — straight to Sunday bracket',
          finishRange: sundayInfo
            ? (() => {
                const r = sundayFinishRanges[sundayInfo.bracketName];
                return r
                  ? `${sundayInfo.bracketName} · best ${r.best}, worst ${r.worst} of 64`
                  : `4 teams · ${sundayInfo.bracketName}`;
              })()
            : '4 teams',
          opponentResolved: sundayOpponent || '',
          hasScores: false,
          weWon: null,
          sets: [],
        });
      }
    }

    // --- Active Sunday bracket (if current play is a Sunday bracket) ---
    let activeSundayBracket: object | null = null;
    if (current && current.length > 0) {
      const currentPlay = current[0]?.Play;
      if (currentPlay?.Type === 1) {
        // Find this bracket in day2
        const sundayPlay = day2?.find((p: { FullName: string }) => p.FullName === currentPlay.FullName);
        if (sundayPlay) {
          // Collect ALL unique matches from the bracket tree, tagged by round depth
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const allMatches: Record<number, any> = {};
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const collectMatches = (node: any, depth: number) => {
            if (!node) return;
            const m = node.Match || {};
            const mid = m.MatchId;
            if (!mid || allMatches[mid]) return;
            const t1 = m.FirstTeam;
            const t2 = m.SecondTeam;
            const t1name = t1?.Name || m.FirstTeamText || 'TBD';
            const t2name = t2?.Name || m.SecondTeamText || 'TBD';
            const t1code = t1?.Code || '';
            const t2code = t2?.Code || '';
            const isUs1 = t1code.toLowerCase() === teamCode.toLowerCase();
            const isUs2 = t2code.toLowerCase() === teamCode.toLowerCase();
            const teamIsFirst = isUs1;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sets = (m.Sets || []).map((s: any) => ({
              us: teamIsFirst ? s.FirstTeamScore : s.SecondTeamScore,
              them: teamIsFirst ? s.SecondTeamScore : s.FirstTeamScore,
              s1: s.FirstTeamScore,
              s2: s.SecondTeamScore,
            })).filter((s: { s1: number | null }) => s.s1 !== null);
            allMatches[mid] = {
              matchId: mid,
              matchName: m.FullName,
              time: fmtTime(m.ScheduledStartDateTime),
              court: m.Court?.Name || '',
              team1: t1name,
              team2: t2name,
              team1code: t1code,
              team2code: t2code,
              hasUs: isUs1 || isUs2,
              hasScores: m.HasScores || false,
              team1Won: m.FirstTeamWon || false,
              team2Won: m.SecondTeamWon || false,
              weWon: m.HasScores ? (isUs1 ? m.FirstTeamWon : m.SecondTeamWon) : null,
              sets,
              depth,
              // Resolve actual team names from source matches if slots still say "Winner of..."
              resolvedTeam1: t1name.startsWith('Winner of') && node.TopSource?.Match?.HasScores
                ? (() => {
                    const sm = node.TopSource.Match;
                    return sm.FirstTeamWon ? (sm.FirstTeam?.Name || sm.FirstTeamText || t1name) : (sm.SecondTeam?.Name || sm.SecondTeamText || t1name);
                  })()
                : t1name,
              resolvedTeam2: t2name.startsWith('Winner of') && node.BottomSource?.Match?.HasScores
                ? (() => {
                    const sm = node.BottomSource.Match;
                    return sm.FirstTeamWon ? (sm.FirstTeam?.Name || sm.FirstTeamText || t2name) : (sm.SecondTeam?.Name || sm.SecondTeamText || t2name);
                  })()
                : t2name,
              isWinnersSide: !t1name.includes('Loser') && !t2name.includes('Loser'),
              topSourceId: node.TopSource?.Match?.MatchId || null,
              bottomSourceId: node.BottomSource?.Match?.MatchId || null,
            };
            collectMatches(node.TopSource, depth + 1);
            collectMatches(node.BottomSource, depth + 1);
          };

          for (const r of (sundayPlay.Roots || [])) {
            collectMatches(r, 0);
            collectMatches(r.TopSource, 1);
            collectMatches(r.BottomSource, 1);
          }
          // Second pass: resolve any remaining "Winner of..." slots using already-resolved match data
          // This handles multi-level chains (Championship needs Semi winner, Semi needs QF winner, etc.)
          let changed = true;
          while (changed) {
            changed = false;
            for (const mid of Object.keys(allMatches)) {
              const match = allMatches[Number(mid)];
              // Try to resolve team1 from topSource
              if (match.resolvedTeam1.startsWith('Winner of') && match.topSourceId) {
                const src = allMatches[match.topSourceId];
                if (src?.hasScores) {
                  const winner = src.team1Won ? (src.resolvedTeam1 || src.team1) : (src.resolvedTeam2 || src.team2);
                  if (winner && !winner.startsWith('Winner of')) {
                    match.resolvedTeam1 = winner;
                    changed = true;
                  }
                } else if (src && !src.resolvedTeam1.startsWith('Winner of') && !src.resolvedTeam2.startsWith('Winner of')) {
                  // Source has resolved teams but not played yet — show as upcoming
                  // (leave as-is, will resolve once scored)
                }
              }
              // Try to resolve team2 from bottomSource
              if (match.resolvedTeam2.startsWith('Winner of') && match.bottomSourceId) {
                const src = allMatches[match.bottomSourceId];
                if (src?.hasScores) {
                  const winner = src.team1Won ? (src.resolvedTeam1 || src.team1) : (src.resolvedTeam2 || src.team2);
                  if (winner && !winner.startsWith('Winner of')) {
                    match.resolvedTeam2 = winner;
                    changed = true;
                  }
                }
              }
            }
          }

          // --- Find the championship match ---
          // It's the depth-0 match whose inputs trace back through pure winners (no losers refs anywhere)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const isPureWinnersMatch = (mid: number): boolean => {
            const m = allMatches[mid];
            if (!m) return false;
            if (m.team1.includes('Loser') || m.team2.includes('Loser')) return false;
            const topOk = !m.topSourceId || isPureWinnersMatch(m.topSourceId);
            const botOk = !m.bottomSourceId || isPureWinnersMatch(m.bottomSourceId);
            return topOk && botOk;
          };

          // Trace back from championship to build the winners ladder
          const winnersLadder: number[][] = []; // each entry = array of matchIds at that stage
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const champMatch = Object.values(allMatches).find((m: any) => m.depth === 0 && isPureWinnersMatch(m.matchId));

          if (champMatch) {
            // BFS backward from championship
            let currentLevel: number[] = [champMatch.matchId];
            while (currentLevel.length > 0) {
              winnersLadder.unshift(currentLevel); // prepend (round 1 first)
              const nextLevel: number[] = [];
              for (const mid of currentLevel) {
                const m = allMatches[mid];
                if (m?.topSourceId && allMatches[m.topSourceId] && isPureWinnersMatch(m.topSourceId)) nextLevel.push(m.topSourceId);
                if (m?.bottomSourceId && allMatches[m.bottomSourceId] && isPureWinnersMatch(m.bottomSourceId)) nextLevel.push(m.bottomSourceId);
              }
              currentLevel = nextLevel;
            }
          }

          // Label the winners ladder stages by size
          const stageLabels = (totalRounds: number, stageIdx: number): string => {
            const stagesFromFinal = totalRounds - 1 - stageIdx;
            if (stagesFromFinal === 0) return 'Championship';
            if (stagesFromFinal === 1) return 'Semifinals';
            if (stagesFromFinal === 2) return 'Quarterfinals';
            const teamsInStage = Math.pow(2, stagesFromFinal + 1);
            return `Round of ${teamsInStage}`;
          };

          // Build winners rounds
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const winnersRounds: { label: string; isChampPath: true; matches: any[] }[] = winnersLadder.map((mids, idx) => ({
            label: stageLabels(winnersLadder.length, idx),
            isChampPath: true,
            matches: mids
              .map((mid: number) => allMatches[mid])
              .filter(Boolean)
              .sort((a: { time: string }, b: { time: string }) => a.time.localeCompare(b.time)),
          }));

          // All non-championship-path matches = placement
          const champMatchIds = new Set(winnersLadder.flat());
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const placementMatches = Object.values(allMatches)
            .filter((m: any) => !champMatchIds.has(m.matchId))
            .sort((a: { time: string }, b: { time: string }) => a.time.localeCompare(b.time));

          activeSundayBracket = {
            bracketName: sundayPlay.FullName,
            completeName: sundayPlay.CompleteFullName,
            courts: (sundayPlay.Courts || []).map((c: { Name: string }) => c.Name),
            winnersRounds,
            placementMatches,
            totalMatches: Object.keys(allMatches).length,
            finishRange: sundayFinishRanges[sundayPlay.FullName] || null,
          };
        }
      }
    }
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

    // --- Final rank: derive from past matches ---
    // AES doesn't expose a clean overallRank field after tournament ends.
    // We derive from the last bracket played and wins/losses within that bracket.
    let finalRank: string | null = null;
    let finalBracket: string | null = null;
    if (past && past.length > 0) {
      const lastBlock = past[past.length - 1];
      const lastPlay = lastBlock.Play?.FullName || '';
      finalBracket = lastPlay;
      const bracketBlocks = past.filter((b: { Play?: { Type?: number } }) => (b.Play?.Type ?? 0) === 1);
      const bracketWins = bracketBlocks.filter((b: { Match?: { FirstTeamId?: number; FirstTeamWon?: boolean; SecondTeamWon?: boolean } }) => {
        const m = b.Match || {};
        const isF = m.FirstTeamId === Number(TEAM_ID);
        return isF ? m.FirstTeamWon : m.SecondTeamWon;
      }).length;

      if (lastPlay.includes('Gold')) {
        if (bracketWins === 4) finalRank = '1st';
        else if (bracketWins === 3) finalRank = '2nd–4th';
        else if (bracketWins === 2) finalRank = '5th–8th';
        else if (bracketWins === 1) finalRank = '9th–12th';
        else finalRank = '13th–16th';
      } else if (lastPlay.includes('Silver')) {
        // Silver A-D are the same tier (ranks 17-32). No 3rd place match within each bracket.
        // Won final = ~17th-20th, lost final = ~21st-24th, lost semi = ~25th-32nd
        if (bracketWins >= 2) finalRank = '17th–20th';
        else if (bracketWins === 1) finalRank = '21st–24th';
        else finalRank = '25th–32nd';
      } else if (lastPlay.includes('Bronze')) {
        if (bracketWins >= 2) finalRank = '33rd–36th';
        else if (bracketWins === 1) finalRank = '37th–40th';
        else finalRank = '41st–48th';
      } else if (lastPlay.includes('Flight')) {
        if (bracketWins >= 2) finalRank = '49th–52nd';
        else if (bracketWins === 1) finalRank = '53rd–56th';
        else finalRank = '57th–64th';
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
      activeSundayBracket,
      finalRank,
      finalBracket,
    });

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
