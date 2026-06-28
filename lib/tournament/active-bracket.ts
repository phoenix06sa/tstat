// Active bracket view: the round-by-round championship-path display for a
// bracket. Built for the bracket our team is in (highlighted) and — once a
// bracket has its teams slotted — for every other bracket too, so Silver,
// flights, etc. render the same scored view as Gold.
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

// Build the round-by-round scored view for a single bracket play node.
// `populated` is true once real teams are slotted (or any match has scores),
// which is the signal the UI uses to switch a bracket from the simple
// who-plays-who tree to this full scored view.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildBracketViewFromPlay(bracketPlay: any, teamCode: string, bracketFinishRanges: FinishRangeMap): object | null {
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
      startRaw: m.ScheduledStartDateTime || '',
      court: m.Court?.Name || '',
      team1: t1name,
      team2: t2name,
      team1code: t1code,
      team2code: t2code,
      // Whether a real team (not a "1st-P2" / "Winner of…" placeholder) is slotted
      team1Real: !!t1?.Name,
      team2Real: !!t2?.Name,
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

  if (Object.keys(allMatches).length === 0) return null;

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

  // Order matches within a round by match number ("Match 1" before "Match 2"),
  // falling back to scheduled time.
  const mnum = (name: string) => { const x = (name || '').match(/(\d+)/); return x ? parseInt(x[1]) : 0; };
  const byMatchNo = (a: { matchName: string; time: string }, b: { matchName: string; time: string }) =>
    mnum(a.matchName) - mnum(b.matchName) || a.time.localeCompare(b.time);

  const winnersRounds = winnersLadder.map((mids, idx) => ({
    label: stageLabels(winnersLadder.length, idx),
    isChampPath: true,
    matches: mids.map((mid: number) => allMatches[mid]).filter(Boolean).sort(byMatchNo),
  }));

  const champMatchIds = new Set(winnersLadder.flat());
  const placementMatches = Object.values(allMatches)
    .filter((m: { matchId: number }) => !champMatchIds.has(m.matchId))
    .sort(byMatchNo);

  // Earliest scheduled match = when the bracket actually starts (the root is
  // the final, which is the LAST match — using it gave the wrong start time)
  const startRaws = Object.values(allMatches)
    .map((m: { startRaw: string }) => m.startRaw)
    .filter((r: string) => r && fmtTime(r))
    .sort();
  const startTime = startRaws.length ? fmtTime(startRaws[0]) : '';

  // A bracket is "populated" once real teams are slotted or any match is
  // scored — the UI's cue to show this scored view instead of the simple tree
  const populated = Object.values(allMatches).some(
    (m: { hasScores: boolean; team1Real: boolean; team2Real: boolean }) =>
      m.hasScores || (m.team1Real && m.team2Real),
  );

  const bracketName = bracketPlay.FullName;
  const range = bracketFinishRanges[bracketName];
  return {
    bracketName,
    completeName: bracketPlay.CompleteFullName,
    courts: (bracketPlay.Courts || []).map((c: { Name: string }) => c.Name),
    winnersRounds,
    placementMatches,
    totalMatches: Object.keys(allMatches).length,
    startTime,
    populated,
    finishRange: range ? { best: `${range.best}`, worst: `${range.worst}`, note: `${Object.keys(allMatches).length} matches in bracket` } : null,
  };
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

  return buildBracketViewFromPlay(bracketPlay, teamCode, bracketFinishRanges);
}

// Build the scored view for every bracket, keyed by bracket name. Later days
// win (the final-day version of a bracket is the live one). The UI uses these
// for all brackets except our own, which keeps the dedicated activeBracket.
export interface AllBracketViewsInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brackets: { play: any }[];
  teamCode: string;
  bracketFinishRanges: FinishRangeMap;
}

export function buildAllBracketViews(input: AllBracketViewsInput): Record<string, object> {
  const { brackets, teamCode, bracketFinishRanges } = input;
  const out: Record<string, object> = {};
  for (const { play } of brackets) {
    const name = play?.FullName || play?.CompleteFullName;
    if (!name) continue;
    const view = buildBracketViewFromPlay(play, teamCode, bracketFinishRanges);
    if (view) out[name] = view;  // last day wins (don't skip if already present)
  }
  return out;
}
