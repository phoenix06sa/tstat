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

// Generate all dates between start and end (inclusive) as YYYY-MM-DD strings
function generateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate.split('T')[0]);
  const end = new Date(endDate.split('T')[0]);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

function fmtTime(iso: string) {
  if (!iso) return '';
  const [, time] = iso.split('T');
  if (!time) return '';
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

// Strip any location code suffix like (LS), (AZ), (NC), etc.
function stripLocationCode(name: string): string {
  return name.replace(/\s*\([A-Z]{2}\)\s*$/, '').trim();
}

// Strip ALL trailing parenthetical suffixes: location codes + explicit ranks
// e.g. "Roots 14-2 Blue (LS) (37)" → "Roots 14-2 Blue"
function stripAllSuffixes(name: string): string {
  return name.replace(/(\s*\([^)]+\))+\s*$/, '').trim();
}

// Extract all team text references from a bracket play's tree
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const teamCode = searchParams.get('team') || 'g14askyl2ls';
  const event = searchParams.get('event') || DEFAULT_EVENT;
  const division = searchParams.get('division') || DEFAULT_DIV;

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
      ? `${new Date(eventDates[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${eventDates.length > 1 ? ` - ${new Date(eventDates[eventDates.length - 1]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}`
      : '';

    // ─── 2. Fetch plays for ALL days ───
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allDaysPlays: { date: string; plays: any[] }[] = [];
    const playsPromises = eventDates.map(date => aes(`/api/event/${event}/division/${division}/plays/${date}`));
    const playsResults = await Promise.all(playsPromises);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ourPool: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ourTeamInfo: any = null;
    let ourPoolDay = '';

    for (const dayData of allDaysPlays) {
      const pools = dayData.plays.filter((p: { PlayType: number }) => p.PlayType === 0);
      for (const pool of pools) {
        const found = (pool.Teams || []).find((t: { TeamCode: string; TeamId: string | number }) => {
          return t.TeamCode?.toLowerCase() === teamCode.toLowerCase() || String(t.TeamId) === teamCode;
        });
        if (found) { ourPool = pool; ourTeamInfo = found; ourPoolDay = dayData.date; break; }
      }
      if (ourPool) break;
    }

    if (!ourPool || !ourTeamInfo) {
      return NextResponse.json({ error: `Team ${teamCode} not found in this division` }, { status: 404 });
    }

    const TEAM_ID = String(ourTeamInfo.TeamId);
    const TEAM_NAME = ourTeamInfo.TeamName;

    // ─── 4. Fetch team-specific schedule ───
    const [current, work, past] = await Promise.all([
      aes(`/api/event/${event}/division/${division}/team/${TEAM_ID}/schedule/current`),
      aes(`/api/event/${event}/division/${division}/team/${TEAM_ID}/schedule/work`),
      aes(`/api/event/${event}/division/${division}/team/${TEAM_ID}/schedule/past`),
    ]);

    // ─── 5. Pool standings with tiebreaker explanation ───
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawTeams: any[] = ourPool.Teams || [];
    const matchRecordGroups: Record<string, typeof rawTeams> = {};
    for (const t of rawTeams) {
      const key = `${t.MatchesWon}-${t.MatchesLost}`;
      if (!matchRecordGroups[key]) matchRecordGroups[key] = [];
      matchRecordGroups[key].push(t);
    }
    const tiebreakers: Record<string, string> = {};
    for (const [record, group] of Object.entries(matchRecordGroups)) {
      if (group.length < 2) continue;
      const setPercs = group.map((t: { SetPercent: number | null }) => t.SetPercent);
      const allSameSetPerc = setPercs.every((v: number | null) => v === setPercs[0]);
      for (const t of group) {
        if (!allSameSetPerc) {
          tiebreakers[t.TeamCode] = `Tied ${record} on matches, advanced by set % (${t.SetPercent !== null ? (t.SetPercent * 100).toFixed(1) : 'N/A'}%)`;
        } else {
          tiebreakers[t.TeamCode] = `Tied ${record} on matches + sets, advanced by point ratio (${t.PointRatio !== null && typeof t.PointRatio === 'number' ? t.PointRatio.toFixed(3) : 'N/A'})`;
        }
      }
    }

    const poolStandings = rawTeams.map((t: { TeamCode: string; TeamName: string; MatchesWon: number; MatchesLost: number; SetsWon: number; SetsLost: number; SetPercent: number | null; PointRatio: number | null; MatchPercent: string; FinishRank: number | null; OverallRank: number | null; FinishRankText: string }) => ({
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

    // ─── 6. All matches (pool + bracket) sorted chronologically with day grouping ───
    const matches: object[] = [];
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
      matches.push({
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
        timestamp: m.ScheduledStartDateTime ? new Date(m.ScheduledStartDateTime).getTime() : 0,
      });
    };

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

    // Sort all matches chronologically
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    matches.sort((a: any, b: any) => a.timestamp - b.timestamp);

    // ─── 7. Work assignments ───
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

    // ─── 8. Bracket paths (what happens based on pool finish) ───
    const futurePaths: object[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sortedStandings = [...rawTeams].sort((a: any, b: any) => (a.FinishRank ?? 99) - (b.FinishRank ?? 99));
    const poolNumber = ourPool.FullName?.match(/Pool (\d+)/)?.[1] || ourPool.ShortName?.replace('P', '') || '?';

    // Find brackets on the same day or next day that reference our pool's teams
    // Brackets are Type=1 plays. After pool play, AES fills in actual team names.
    // Before pool play completes, brackets show tags like "1st-P5", "2nd-P5", etc.

    // Collect ALL brackets across all days for lookup
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allBrackets: { date: string; play: any }[] = [];
    for (const dayData of allDaysPlays) {
      for (const play of dayData.plays) {
        if (play.PlayType === 1) {
          allBrackets.push({ date: dayData.date, play });
        }
      }
    }

    // Find which bracket a team/tag appears in
    const findBracketForTeamOrTag = (searchText: string): { bracketName: string; court: string; time: string; date: string } | null => {
      for (const { date, play } of allBrackets) {
        const sources = extractAllSources(play);
        let found = false;
        for (const source of sources) {
          if (source === searchText || source.includes(searchText) || stripLocationCode(source) === stripLocationCode(searchText) || stripAllSuffixes(source) === stripAllSuffixes(searchText)) {
            found = true;
            break;
          }
        }
        if (!found) continue;
        // Found bracket — get court/time from root match
        const rootMatch = play.Roots?.[0]?.Match;
        return {
          bracketName: play.FullName || play.CompleteFullName,
          court: rootMatch?.Court?.Name || '',
          time: fmtTime(rootMatch?.ScheduledStartDateTime || ''),
          date: fmtDate(rootMatch?.ScheduledStartDateTime || date),
        };
      }
      return null;
    };

    // Find Sunday/final bracket destination for winner/loser of a bracket match
    const findFinalBracketForTag = (tag: string): { bracketName: string } | null => {
      // Look in the last day's brackets for this tag
      const lastDay = allDaysPlays[allDaysPlays.length - 1];
      if (!lastDay) return null;
      const finalBrackets = lastDay.plays.filter((p: { PlayType: number }) => p.PlayType === 1);
      for (const b of finalBrackets) {
        const sources = extractAllSources(b);
        if (sources.has(tag)) return { bracketName: b.FullName };
      }
      return null;
    };

    // Build bracket finish range map dynamically from final day brackets
    const finalDay = allDaysPlays[allDaysPlays.length - 1];
    const finalBrackets = finalDay ? finalDay.plays.filter((p: { PlayType: number }) => p.PlayType === 1) : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bracketFinishRanges: Record<string, { best: number; worst: number }> = {};
    let rankOffset = 1;
    for (const b of finalBrackets) {
      const frms = b.FutureRoundMatches || [];
      const rankedCount = frms.filter((f: { RankText: string }) => f.RankText).length;
      const teamCount = rankedCount || (b.Roots?.length ? Math.pow(2, Math.ceil(Math.log2(b.Roots.length * 2))) : 4);
      bracketFinishRanges[b.FullName] = { best: rankOffset, worst: rankOffset + teamCount - 1 };
      rankOffset += teamCount;
    }

    // Build future paths for each pool rank (1st through last)
    const poolSize = rawTeams.length;
    for (let poolRank = 1; poolRank <= poolSize; poolRank++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const teamAtRank: any = sortedStandings[poolRank - 1];
      const isUs = teamAtRank?.TeamCode?.toLowerCase() === teamCode.toLowerCase();
      const poolPlayComplete = teamAtRank?.FinishRank !== null;
      const rankSuffix = poolRank === 1 ? 'st' : poolRank === 2 ? 'nd' : poolRank === 3 ? 'rd' : 'th';
      const finishText = `${poolRank}${rankSuffix}-P${poolNumber}`;
      const displayTeamName = poolPlayComplete ? (teamAtRank?.TeamName || '') : `${poolRank}${rankSuffix} place (TBD)`;

      // Search for the bracket this team goes to
      // Try tag format first (before pool play completes): "1st-P5", "2nd-P5"
      const rankTag = `${poolRank}${rankSuffix}-P${poolNumber}`;
      // After pool play: search by actual team name with location code
      const teamText = teamAtRank?.TeamText || (teamAtRank?.TeamName ? `${teamAtRank.TeamName}` : '');

      let bracketInfo = findBracketForTeamOrTag(rankTag);
      if (!bracketInfo && teamText && poolPlayComplete) {
        bracketInfo = findBracketForTeamOrTag(teamText);
      }

      // Determine finish range
      let finishRange = '';
      if (bracketInfo) {
        const range = bracketFinishRanges[bracketInfo.bracketName];
        if (range) {
          const ordinal = (n: number) => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
          finishRange = `${bracketInfo.bracketName} · best ${ordinal(range.best)}, worst ${ordinal(range.worst)}`;
        } else {
          finishRange = bracketInfo.bracketName;
        }
      } else {
        finishRange = 'Bracket TBD';
      }

      // Find opponent in bracket
      let opponentResolved = '';
      if (bracketInfo && poolPlayComplete && teamText) {
        for (const { play } of allBrackets) {
          if (play.FullName !== bracketInfo.bracketName) continue;
          for (const r of (play.Roots || [])) {
            const m = r.Match || {};
            const t1: string = m.FirstTeamText || '';
            const t2: string = m.SecondTeamText || '';
            if (stripLocationCode(t1) === stripLocationCode(teamText) || t1.includes(teamAtRank?.TeamName)) {
              opponentResolved = stripLocationCode(t2);
            } else if (stripLocationCode(t2) === stripLocationCode(teamText) || t2.includes(teamAtRank?.TeamName)) {
              opponentResolved = stripLocationCode(t1);
            }
            // Also check sub-matches
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const checkNode = (node: any): string => {
              if (!node) return '';
              const nm = node.Match || {};
              const nt1: string = nm.FirstTeamText || '';
              const nt2: string = nm.SecondTeamText || '';
              if (stripLocationCode(nt1) === stripLocationCode(teamText) || nt1.includes(teamAtRank?.TeamName)) {
                return stripLocationCode(nt2);
              }
              if (stripLocationCode(nt2) === stripLocationCode(teamText) || nt2.includes(teamAtRank?.TeamName)) {
                return stripLocationCode(nt1);
              }
              return checkNode(node.TopSource) || checkNode(node.BottomSource);
            };
            if (!opponentResolved) opponentResolved = checkNode(r.TopSource) || checkNode(r.BottomSource);
          }
          break;
        }
      }

      // Find where winner/loser of the intermediate bracket end up in the final brackets.
      // Approach 1: Trace actual teams via FutureRoundMatches rank results → find in final brackets.
      // Approach 2 (fallback): Look for Tags like "Winner of XBrkt#1M1" in final brackets.
      let nextDestination = '';
      if (bracketInfo) {
        // Find the intermediate bracket's FutureRoundMatches to get winner/loser team names
        let intermediateBracketPlay = null;
        for (const { play } of allBrackets) {
          if (play.FullName === bracketInfo.bracketName) { intermediateBracketPlay = play; break; }
        }

        if (intermediateBracketPlay) {
          const frms = intermediateBracketPlay.FutureRoundMatches || [];
          const rankedFrms = frms.filter((f: { RankText: string }) => f.RankText);

          // If this bracket has ranked results, trace where each rank's team goes in final brackets
          if (rankedFrms.length >= 2) {
            const winnerRt: string = rankedFrms[0]?.RankText || '';
            const loserRt: string = rankedFrms[1]?.RankText || '';

            const extractTeam = (rt: string): string => {
              const mtch = rt.match(/^\d+\s*-\s*(.+)$/);
              if (!mtch) return '';
              let name = mtch[1].trim().replace(/\s*\(\d+\)\s*$/, ''); // strip explicit rank
              return name;
            };

            const winnerTeam = extractTeam(winnerRt);
            const loserTeam = extractTeam(loserRt);

            // Find which final bracket each team appears in
            const findFinalBracketForTeam = (teamSearch: string): string | null => {
              if (!teamSearch || teamSearch.startsWith('Winner of') || teamSearch.startsWith('Loser of')) return null;
              const stripped = stripLocationCode(teamSearch).toLowerCase();
              for (const fb of finalBrackets) {
                const frm = fb.FutureRoundMatches || [];
                for (const f of frm) {
                  const rt: string = f.RankText || '';
                  if (rt.toLowerCase().includes(stripped)) return fb.FullName;
                }
                // Also check match team texts
                const sources = extractAllSources(fb);
                for (const src of sources) {
                  if (stripLocationCode(src).toLowerCase() === stripped) return fb.FullName;
                }
              }
              return null;
            };

            const winDest = findFinalBracketForTeam(winnerTeam);
            const loseDest = findFinalBracketForTeam(loserTeam);

            if (winDest || loseDest) {
              // If both go to the same bracket, it IS the final bracket (no intermediate step)
              if (winDest && loseDest && winDest === loseDest) {
                // Don't show Win/Lose when the intermediate bracket IS the final bracket
              } else {
                const parts: string[] = [];
                if (winDest) {
                  const wr = bracketFinishRanges[winDest];
                  parts.push(`Win → ${winDest}${wr ? ` (${wr.best}-${wr.worst})` : ''}`);
                }
                if (loseDest) {
                  const lr = bracketFinishRanges[loseDest];
                  parts.push(`Lose → ${loseDest}${lr ? ` (${lr.best}-${lr.worst})` : ''}`);
                }
                nextDestination = parts.join('\n');
              }
            }
          }
        }

        // Fallback: try Tag-based approach for unplayed tournaments
        if (!nextDestination) {
          const brktShortName = bracketInfo.bracketName.replace(/^.*?(Challenge Bracket|Cross Bracket|Cross-Pool Match)/, '$1');
          const winTag = `Winner of ${brktShortName.replace('Bracket #', 'Brkt#').replace('Bracket#', 'Brkt#')}M1`;
          const loseTag = `Loser of ${brktShortName.replace('Bracket #', 'Brkt#').replace('Bracket#', 'Brkt#')}M1`;
          const winDest = findFinalBracketForTag(winTag);
          const loseDest = findFinalBracketForTag(loseTag);
          if (winDest || loseDest) {
            const parts: string[] = [];
            if (winDest) {
              const wr = bracketFinishRanges[winDest.bracketName];
              parts.push(`Win → ${winDest.bracketName}${wr ? ` (${wr.best}-${wr.worst})` : ''}`);
            }
            if (loseDest) {
              const lr = bracketFinishRanges[loseDest.bracketName];
              parts.push(`Lose → ${loseDest.bracketName}${lr ? ` (${lr.best}-${lr.worst})` : ''}`);
            }
            nextDestination = parts.join('\n');
          }
        }
      }

      futurePaths.push({
        finishText,
        rank: poolRank,
        isUs,
        teamAtRank: displayTeamName,
        nextPlay: bracketInfo?.bracketName || 'TBD',
        nextPlayShort: bracketInfo?.bracketName || 'TBD',
        court: bracketInfo?.court || '',
        time: bracketInfo?.time || '',
        bracketDate: bracketInfo?.date || '',
        workCourt: '',
        workTime: '',
        opponentResolved,
        finishRange: nextDestination || finishRange,
      });
    }

    // ─── 9. Active bracket view ───
    // If the team is currently in a bracket (or tournament is over and last play was bracket)
    let activeBracket: object | null = null;
    let activeBracketPlayName: string | null = null;

    if (current && current.length > 0) {
      const currentPlay = current[0]?.Play;
      if (currentPlay?.Type === 1) activeBracketPlayName = currentPlay.FullName;
    }
    if (!activeBracketPlayName && past && past.length > 0) {
      for (let i = past.length - 1; i >= 0; i--) {
        if (past[i]?.Play?.Type === 1) {
          activeBracketPlayName = past[i].Play.FullName;
          break;
        }
      }
    }

    if (activeBracketPlayName) {
      // Find the bracket play data from our allDaysPlays
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let bracketPlay: any = null;
      for (const dayData of allDaysPlays) {
        const found = dayData.plays.find((p: { FullName: string }) => p.FullName === activeBracketPlayName);
        if (found) { bracketPlay = found; break; }
      }

      if (bracketPlay) {
        // Collect all matches from the bracket tree
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
            resolvedTeam1: m.HasScores
              ? (t1name.startsWith('Winner of') && node.TopSource?.Match?.HasScores
                  ? (() => { const sm = node.TopSource.Match; return sm.FirstTeamWon ? (sm.FirstTeam?.Name || sm.FirstTeamText || t1name) : (sm.SecondTeam?.Name || sm.SecondTeamText || t1name); })()
                  : t1name)
              : (m.FirstTeamText || t1name),
            resolvedTeam2: m.HasScores
              ? (t2name.startsWith('Winner of') && node.BottomSource?.Match?.HasScores
                  ? (() => { const sm = node.BottomSource.Match; return sm.FirstTeamWon ? (sm.FirstTeam?.Name || sm.FirstTeamText || t2name) : (sm.SecondTeam?.Name || sm.SecondTeamText || t2name); })()
                  : t2name)
              : (m.SecondTeamText || t2name),
            isWinnersSide: !t1name.includes('Loser') && !t2name.includes('Loser'),
            topSourceId: node.TopSource?.Match?.MatchId || null,
            bottomSourceId: node.BottomSource?.Match?.MatchId || null,
          };
          collectMatches(node.TopSource, depth + 1);
          collectMatches(node.BottomSource, depth + 1);
        };

        for (const r of (bracketPlay.Roots || [])) {
          collectMatches(r, 0);
          collectMatches(r.TopSource, 1);
          collectMatches(r.BottomSource, 1);
        }

        // Resolve "Winner of..." chains
        let changed = true;
        while (changed) {
          changed = false;
          for (const mid of Object.keys(allMatches)) {
            const match = allMatches[Number(mid)];
            if (match.resolvedTeam1.startsWith('Winner of') && match.topSourceId) {
              const src = allMatches[match.topSourceId];
              if (src?.hasScores) {
                const winner = src.team1Won ? (src.resolvedTeam1 || src.team1) : (src.resolvedTeam2 || src.team2);
                if (winner && !winner.startsWith('Winner of')) { match.resolvedTeam1 = winner; changed = true; }
              }
            }
            if (match.resolvedTeam2.startsWith('Winner of') && match.bottomSourceId) {
              const src = allMatches[match.bottomSourceId];
              if (src?.hasScores) {
                const winner = src.team1Won ? (src.resolvedTeam1 || src.team1) : (src.resolvedTeam2 || src.team2);
                if (winner && !winner.startsWith('Winner of')) { match.resolvedTeam2 = winner; changed = true; }
              }
            }
          }
        }

        // Build winners ladder (championship path)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isPureWinnersMatch = (mid: number): boolean => {
          const m = allMatches[mid];
          if (!m) return false;
          if (m.team1.includes('Loser') || m.team2.includes('Loser')) return false;
          const topOk = !m.topSourceId || isPureWinnersMatch(m.topSourceId);
          const botOk = !m.bottomSourceId || isPureWinnersMatch(m.bottomSourceId);
          return topOk && botOk;
        };

        const winnersLadder: number[][] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const champMatch = Object.values(allMatches).find((m: any) => m.depth === 0 && isPureWinnersMatch(m.matchId));

        if (champMatch) {
          let currentLevel: number[] = [champMatch.matchId];
          while (currentLevel.length > 0) {
            winnersLadder.unshift(currentLevel);
            const nextLevel: number[] = [];
            for (const mid of currentLevel) {
              const m = allMatches[mid];
              if (m?.topSourceId && allMatches[m.topSourceId] && isPureWinnersMatch(m.topSourceId)) nextLevel.push(m.topSourceId);
              if (m?.bottomSourceId && allMatches[m.bottomSourceId] && isPureWinnersMatch(m.bottomSourceId)) nextLevel.push(m.bottomSourceId);
            }
            currentLevel = nextLevel;
          }
        }

        const stageLabels = (totalRounds: number, stageIdx: number): string => {
          const stagesFromFinal = totalRounds - 1 - stageIdx;
          if (stagesFromFinal === 0) return 'Championship';
          if (stagesFromFinal === 1) return 'Semifinals';
          if (stagesFromFinal === 2) return 'Quarterfinals';
          return `Round of ${Math.pow(2, stagesFromFinal + 1)}`;
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const winnersRounds = winnersLadder.map((mids, idx) => ({
          label: stageLabels(winnersLadder.length, idx),
          isChampPath: true,
          matches: mids.map((mid: number) => allMatches[mid]).filter(Boolean)
            .sort((a: { time: string }, b: { time: string }) => a.time.localeCompare(b.time)),
        }));

        const champMatchIds = new Set(winnersLadder.flat());
        const placementMatches = Object.values(allMatches)
          .filter((m: { matchId: number }) => !champMatchIds.has(m.matchId))
          .sort((a: { time: string }, b: { time: string }) => a.time.localeCompare(b.time));

        const range = bracketFinishRanges[activeBracketPlayName!];
        activeBracket = {
          bracketName: bracketPlay.FullName,
          completeName: bracketPlay.CompleteFullName,
          courts: (bracketPlay.Courts || []).map((c: { Name: string }) => c.Name),
          winnersRounds,
          placementMatches,
          totalMatches: Object.keys(allMatches).length,
          finishRange: range ? { best: `${range.best}`, worst: `${range.worst}`, note: `${Object.keys(allMatches).length} matches in bracket` } : null,
        };
      }
    }

    // ─── 10. Final standings from last day's brackets using RankText ───
    // In a single-elimination bracket, teams that lose in the same round are tied.
    // Sibling brackets (e.g. Silver A + Silver B) share a base offset, and teams
    // at the same elimination round across siblings are also tied.
    type FinalStanding = { overallRank: number; tied: boolean; teamName: string; teamCode: string; bracket: string; bracketRank: number; isUs: boolean };
    let finalStandings: FinalStanding[] = [];

    // Convert sequential bracket rank to elimination-bracket tied rank.
    // e.g. in a 16-team bracket: ranks 9-16 all lose in round 1 → tied at 9th
    function eliminationTiedRank(bracketRank: number): number {
      if (bracketRank <= 2) return bracketRank;
      return Math.pow(2, Math.floor(Math.log2(bracketRank - 1))) + 1;
    }

    // Extract tier name from bracket name by stripping trailing letter/number suffixes.
    // "Silver A Bracket" → "Silver", "Flight 1A Bracket" → "Flight 1",
    // "Gold Bracket" → "Gold", "Flight 4 Bracket" → "Flight 4"
    function bracketTier(name: string): string {
      return name
        .replace(/\s*Bracket\s*$/i, '')
        .replace(/\s+[A-Z]$/i, '')      // "Silver A" → "Silver"
        .replace(/([0-9])[A-Z]$/i, '$1') // "Flight 1A" → "Flight 1"
        .trim();
    }

    if (finalDay) {
      const finalPlays = finalDay.plays.filter((p: { PlayType: number }) => p.PlayType === 1);

      // Step 1: Parse all bracket entries
      type ParsedEntry = { bracketRank: number; teamName: string; explicitOverallRank: number | null; bracketName: string; tier: string };
      const allParsedEntries: ParsedEntry[] = [];
      let hasAnyExplicitRanks = false;

      for (const play of finalPlays) {
        const bracketName = play.FullName || '';
        const tier = bracketTier(bracketName);
        const frms = play.FutureRoundMatches || [];
        const rankedEntries = frms.filter((f: { RankText: string }) => f.RankText);
        if (rankedEntries.length === 0) continue;

        for (const entry of rankedEntries) {
          const rt: string = entry.RankText || '';
          const m = rt.match(/^(\d+)\s*-\s*(.+)$/);
          if (!m) continue;

          const bracketRank = parseInt(m[1]);
          let teamNameRaw = m[2].trim();
          // Check for explicit overall rank: "TeamName (LOC) (N)"
          const overallMatch = teamNameRaw.match(/\((\d+)\)\s*$/);
          const explicitOverallRank = overallMatch ? parseInt(overallMatch[1]) : null;
          if (overallMatch) teamNameRaw = teamNameRaw.replace(/\s*\(\d+\)\s*$/, '');
          if (explicitOverallRank !== null) hasAnyExplicitRanks = true;
          // Strip location code
          const teamName = stripLocationCode(teamNameRaw);
          // Skip placeholder entries (unplayed tournament)
          if (teamName.startsWith('Winner of') || teamName.startsWith('Loser of')) continue;
          allParsedEntries.push({ bracketRank, teamName, explicitOverallRank, bracketName, tier });
        }
      }

      if (hasAnyExplicitRanks) {
        // Tournament provides explicit overall ranks (e.g. Lone Star Regionals)
        for (const entry of allParsedEntries) {
          finalStandings.push({
            overallRank: entry.explicitOverallRank ?? entry.bracketRank,
            tied: false,
            teamName: entry.teamName,
            teamCode: '',
            bracket: entry.bracketName,
            bracketRank: entry.bracketRank,
            isUs: entry.teamName === TEAM_NAME || stripLocationCode(entry.teamName).toLowerCase() === TEAM_NAME.toLowerCase(),
          });
        }
      } else {
        // Step 2: Group brackets by tier to find siblings
        const tierMap: Record<string, { bracketName: string; entries: ParsedEntry[] }[]> = {};
        const tierOrder: string[] = [];
        for (const entry of allParsedEntries) {
          if (!tierMap[entry.tier]) { tierMap[entry.tier] = []; tierOrder.push(entry.tier); }
          let bracket = tierMap[entry.tier].find(b => b.bracketName === entry.bracketName);
          if (!bracket) { bracket = { bracketName: entry.bracketName, entries: [] }; tierMap[entry.tier].push(bracket); }
          bracket.entries.push(entry);
        }

        // Step 3: For each tier, compute overall ranks using elimination bracket tied ranks
        let baseOffset = 0;
        for (const tier of tierOrder) {
          const siblings = tierMap[tier];

          // Collect all unique elimination tied ranks in this tier
          const tiedRankGroups: Map<number, ParsedEntry[]> = new Map();
          for (const bracket of siblings) {
            for (const entry of bracket.entries) {
              const tr = eliminationTiedRank(entry.bracketRank);
              if (!tiedRankGroups.has(tr)) tiedRankGroups.set(tr, []);
              tiedRankGroups.get(tr)!.push(entry);
            }
          }

          // Sort tied rank groups by their elimination rank
          const sortedTiedRanks = [...tiedRankGroups.keys()].sort((a, b) => a - b);

          // Assign overall ranks: each group's rank = baseOffset + 1 + teams in all previous groups
          let teamsBeforeThisGroup = 0;
          for (const tr of sortedTiedRanks) {
            const groupEntries = tiedRankGroups.get(tr)!;
            const overallRank = baseOffset + teamsBeforeThisGroup + 1;
            const isTied = groupEntries.length > 1;

            for (const entry of groupEntries) {
              finalStandings.push({
                overallRank,
                tied: isTied,
                teamName: entry.teamName,
                teamCode: '',
                bracket: entry.bracketName,
                bracketRank: entry.bracketRank,
                isUs: entry.teamName === TEAM_NAME || stripLocationCode(entry.teamName).toLowerCase() === TEAM_NAME.toLowerCase(),
              });
            }

            teamsBeforeThisGroup += groupEntries.length;
          }

          // Advance base offset by total teams in this tier
          const totalTeamsInTier = siblings.reduce((sum, b) => sum + b.entries.length, 0);
          baseOffset += totalTeamsInTier;
        }
      }

      // Deduplicate
      const seen = new Set<string>();
      finalStandings = finalStandings.filter(s => {
        const key = `${s.overallRank}|${s.teamName}`;
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });

      // Sort by overall rank, then bracket name for ties
      finalStandings.sort((a, b) => a.overallRank - b.overallRank || a.bracket.localeCompare(b.bracket));
    }

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
      matches,
      workAssignments,
      futurePaths,
      activeBracket,
      finalStandings,
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
