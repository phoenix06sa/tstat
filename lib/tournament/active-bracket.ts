// Active bracket view: the round-by-round championship-path display for the
// bracket our team is currently in (or finished in).
//
// AES populates team slots one round ahead; later rounds say "Winner of
// Match N" with null FirstTeam. The iterative resolution loop below keeps
// substituting winners until no more changes, so all rounds fill in as the
// day progresses.

import { fmtTime } from '@/lib/aes';
import type { DayPlays, FinishRangeMap } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMatch = any;

export interface ActiveBracketInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  current: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  past: any;
  allDaysPlays: DayPlays[];
  teamCode: string;
  bracketFinishRanges: FinishRangeMap;
}

export function buildActiveBracket(input: ActiveBracketInput): object | null {
  const { current, past, allDaysPlays, teamCode, bracketFinishRanges } = input;

  // Find the bracket the team is currently in (or, if the tournament is
  // over, the last bracket they played in)
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

  if (!activeBracketPlayName) return null;

  // Find the bracket play data from our allDaysPlays
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bracketPlay: any = null;
  for (const dayData of allDaysPlays) {
    const found = dayData.plays.find((p: { FullName: string }) => p.FullName === activeBracketPlayName);
    if (found) { bracketPlay = found; break; }
  }

  if (!bracketPlay) return null;

  // Collect all matches from the bracket tree
  const allMatches: Record<number, AnyMatch> = {};
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

  // Build winners ladder (championship path): a match is on the pure
  // winners path only if no ancestor feeds in a "Loser of..." reference
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

  const range = bracketFinishRanges[activeBracketPlayName];
  return {
    bracketName: bracketPlay.FullName,
    completeName: bracketPlay.CompleteFullName,
    courts: (bracketPlay.Courts || []).map((c: { Name: string }) => c.Name),
    winnersRounds,
    placementMatches,
    totalMatches: Object.keys(allMatches).length,
    finishRange: range ? { best: `${range.best}`, worst: `${range.worst}`, note: `${Object.keys(allMatches).length} matches in bracket` } : null,
  };
}
