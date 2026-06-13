// Bracket paths: where each pool finish rank leads, with full bracket trees
// for display and finish-range predictions.
//
// Two-tier matching strategy (AES replaces seed text like "1st-P5" with real
// team names once pool play completes):
//   1. Before pool play: parse pool-reference text from bracket leaf nodes
//   2. After pool play: match actual team names in the bracket tree

import { fmtTime, fmtDate, stripLocationCode, stripAllSuffixes, ordinal, extractAllSources } from '@/lib/aes';
import type { DayPlays, BracketEntry, FinishRangeMap } from './types';

export interface PoolRef {
  rank: number;
  poolNum: string;
}

// Parse pool rank reference from a bracket team text.
// AES uses inconsistent formats across tournaments, so we try multiple patterns:
//   "1st-R1 D1 Pool 1  (1)"  → { rank: 1, poolNum: "1" }
//   "2nd-P5"                  → { rank: 2, poolNum: "5" }
//   "3rd-R1 D1 Pool 3  (9)"  → { rank: 3, poolNum: "3" }
//   "1st Place Pool 2"       → { rank: 1, poolNum: "2" }
//   "Pool 1 - 1st"           → { rank: 1, poolNum: "1" }
export function parsePoolRef(text: string): PoolRef | null {
  // Format: "Nth-R... Pool X (...)" or "Nth-...Pool X..."
  const longMatch = text.match(/^(\d+)(?:st|nd|rd|th)-.*Pool\s+(\d+)/i);
  if (longMatch) return { rank: parseInt(longMatch[1]), poolNum: longMatch[2] };
  // Format: "Nth-PX"
  const shortMatch = text.match(/^(\d+)(?:st|nd|rd|th)-P(\d+)/i);
  if (shortMatch) return { rank: parseInt(shortMatch[1]), poolNum: shortMatch[2] };
  // Format: "Nth Place Pool X" or "Nth-Place Pool X"
  const placeMatch = text.match(/^(\d+)(?:st|nd|rd|th)[\s-]+(?:place\s+)?Pool\s+(\d+)/i);
  if (placeMatch) return { rank: parseInt(placeMatch[1]), poolNum: placeMatch[2] };
  // Format: "Pool X - Nth" or "Pool X Nth"
  const reverseMatch = text.match(/Pool\s+(\d+)\s*[-–]?\s*(\d+)(?:st|nd|rd|th)/i);
  if (reverseMatch) return { rank: parseInt(reverseMatch[2]), poolNum: reverseMatch[1] };
  // Broad fallback: any text containing both an ordinal and "P" or "Pool" + number
  const broadMatch = text.match(/(\d+)(?:st|nd|rd|th).*?(?:Pool|P)\s*(\d+)/i);
  if (broadMatch) return { rank: parseInt(broadMatch[1]), poolNum: broadMatch[2] };
  return null;
}

// "Nth Pl/Place" in a bracket name. Used two ways:
// - as a rank anchor: a "5th Place Bracket" starts at overall rank 5
// - as a refinement hint when no results exist yet (see below)
export function placementAnchor(name: string): number | null {
  const m = (name || '').match(/\b(\d+)(?:st|nd|rd|th)[\s-]*(?:pl|place)\b/i);
  return m ? parseInt(m[1]) : null;
}

// Extract team names from a bracket's ranked FutureRoundMatches entries
// ("N - Team Name (LOC)" → "team name"), skipping unplayed placeholders.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rankedTeamNames(play: any): string[] {
  const names: string[] = [];
  for (const f of (play.FutureRoundMatches || [])) {
    const m = (f.RankText || '').match(/^(\d+)\s*-\s*(.+)$/);
    if (!m) continue;
    const name = stripAllSuffixes(m[2].trim());
    if (!name || name.startsWith('Winner of') || name.startsWith('Loser of')) continue;
    names.push(name.toLowerCase());
  }
  return names;
}

// A bracket is a placement REFINEMENT (e.g. ALSC2's "5th Pl Bracket" where
// Gold quarterfinal losers replay for exact 5th-8th) when every team in it
// already holds a rank in an earlier bracket — those must not add to finish
// ranges or standings. Some events instead use "5th Place Bracket" as a
// team's ONLY final-day play (SLC 14 Open); those count normally.
// With no results yet, fall back to the name hint.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isRefinementBracket(play: any, seenTeams: Set<string>): boolean {
  const names = rankedTeamNames(play);
  if (names.length > 0) return names.every(n => seenTeams.has(n));
  return placementAnchor(play.FullName) !== null;
}

// Build bracket finish range map dynamically from the final day's bracket
// plays. Ranges accumulate in play order: Gold 1-16, Silver 17-32, etc.
// "Nth Place" brackets anchor at rank N (leaving a gap for any placements
// decided without a final-day bracket).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildFinishRanges(finalBrackets: any[]): { bracketFinishRanges: FinishRangeMap; totalTeams: number } {
  const bracketFinishRanges: FinishRangeMap = {};
  const seenTeams = new Set<string>();
  let rankOffset = 1;
  for (const b of finalBrackets) {
    if (isRefinementBracket(b, seenTeams)) continue;
    for (const n of rankedTeamNames(b)) seenTeams.add(n);
    const anchor = placementAnchor(b.FullName);
    if (anchor && anchor > rankOffset) rankOffset = anchor;
    const frms = b.FutureRoundMatches || [];
    const rankedCount = frms.filter((f: { RankText: string }) => f.RankText).length;
    const teamCount = rankedCount || (b.Roots?.length ? Math.pow(2, Math.ceil(Math.log2(b.Roots.length * 2))) : 4);
    bracketFinishRanges[b.FullName] = { best: rankOffset, worst: rankOffset + teamCount - 1 };
    rankOffset += teamCount;
  }
  // Total teams in the tournament, as implied by the final brackets
  return { bracketFinishRanges, totalTeams: rankOffset - 1 };
}

export interface BracketRoundMatch {
  matchName: string;
  team1: string;
  team2: string;
  court: string;
  time: string;
  isPlacement: boolean;
  hasUs: boolean;
}

export interface BracketRound {
  label: string;
  matches: BracketRoundMatch[];
}

export interface FuturePath {
  finishText: string;
  rank: number;
  isUs: boolean;
  teamAtRank: string;
  nextPlay: string;
  nextPlayShort: string;
  court: string;
  time: string;
  bracketDate: string;
  workCourt: string;
  workTime: string;
  opponentResolved: string;
  finishRange: string;
  seed: number | null;
  bracketRounds: BracketRound[];
  bracketTeamCount: number;
}

interface LeafMatchup {
  t1: string;
  t2: string;
  court: string;
  time: string;
}

// Walk bracket tree to get all leaf-level matchup team texts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLeafMatchups(node: any): LeafMatchup[] {
  if (!node) return [];
  const m = node.Match || {};
  const ts = node.TopSource;
  const bs = node.BottomSource;
  if (!ts && !bs) {
    return [{ t1: m.FirstTeamText || '', t2: m.SecondTeamText || '', court: m.Court?.Name || '', time: m.ScheduledStartDateTime || '' }];
  }
  const results: LeafMatchup[] = [];
  if (ts) results.push(...getLeafMatchups(ts));
  else results.push({ t1: m.FirstTeamText || '', t2: '', court: m.Court?.Name || '', time: m.ScheduledStartDateTime || '' });
  if (bs) results.push(...getLeafMatchups(bs));
  else results.push({ t1: '', t2: m.SecondTeamText || '', court: m.Court?.Name || '', time: m.ScheduledStartDateTime || '' });
  return results;
}

export interface BracketPathsInput {
  allBrackets: BracketEntry[];
  allDaysPlays: DayPlays[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawTeams: any[];
  teamCode: string;
  teamName: string;
  poolNumber: string;
  bracketFinishRanges: FinishRangeMap;
}

export function buildBracketPaths(input: BracketPathsInput): {
  futurePaths: FuturePath[];
  bracketTrees: Record<string, { rounds: BracketRound[]; teamCount: number; startTime: string }>;
} {
  const { allBrackets, allDaysPlays, rawTeams, teamCode, teamName, poolNumber, bracketFinishRanges } = input;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sortedStandings = [...rawTeams].sort((a: any, b: any) => (a.FinishRank ?? 99) - (b.FinishRank ?? 99));

  // Build a map: poolNum_rank → { bracketName, matchups, court, time, date }
  // by parsing leaf-level team texts in each bracket
  type BracketMapping = {
    bracketName: string;
    court: string;
    time: string;
    date: string;
    matchups: { t1: string; t2: string; t1Pool: PoolRef | null; t2Pool: PoolRef | null; court: string; time: string }[];
    seed: number | null;
    opponentRef: string | null;
  };
  const poolRankToBracket: Record<string, BracketMapping> = {};

  // Build full bracket tree structure for display (round-by-round)
  const bracketTrees: Record<string, { rounds: BracketRound[]; teamCount: number; startTime: string }> = {};

  // Helper: format a team text reference into a display-friendly name
  const formatTeamDisplay = (text: string): string => {
    if (!text) return 'TBD';
    if (text.startsWith('Winner of') || text.startsWith('Loser of')) return text;
    const ref = parsePoolRef(text);
    if (ref) {
      // Check if pool play is done for this pool — try to resolve to actual team
      const pool = allDaysPlays.flatMap(d => d.plays).filter((p: { PlayType: number }) => p.PlayType === 0)
        .find((p: { FullName: string }) => p.FullName?.match(/Pool (\d+)/)?.[1] === ref.poolNum);
      if (pool) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const teams = [...(pool.Teams || [])].sort((a: any, b: any) => (a.FinishRank ?? 99) - (b.FinishRank ?? 99));
        const team = teams[ref.rank - 1];
        if (team?.FinishRank !== null && team?.FinishRank !== undefined) {
          return team.TeamName;
        }
      }
      return `${ordinal(ref.rank)} Pool ${ref.poolNum}`;
    }
    return stripAllSuffixes(text);
  };

  // Helper: check if a team text references our team or pool position
  const isOurTeamRef = (text: string): boolean => {
    if (!text) return false;
    const ref = parsePoolRef(text);
    if (ref && ref.poolNum === poolNumber) {
      // Could be any of our pool ranks — mark for ALL our possible positions
      return true;
    }
    // Check actual team name
    if (text.toLowerCase().includes(teamCode.toLowerCase())) return true;
    const stripped = stripAllSuffixes(text).toLowerCase();
    if (stripped === teamName.toLowerCase()) return true;
    return false;
  };

  for (const { date, play } of allBrackets) {
    const bracketName = play.FullName || play.CompleteFullName;
    const rootMatch = play.Roots?.[0]?.Match;
    const bracketCourt = rootMatch?.Court?.Name || '';
    const bracketTime = fmtTime(rootMatch?.ScheduledStartDateTime || '');
    const bracketDate = fmtDate(rootMatch?.ScheduledStartDateTime || date);

    // Walk bracket tree collecting matches by depth
    const matchesByDepth: Record<number, BracketRoundMatch[]> = {};
    let maxDepth = 0;
    // Earliest scheduled match = when the bracket starts (the root is the
    // final, the LAST match — using it gave the wrong "starts" time)
    const startRaws: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walkTree = (node: any, depth: number, isPlacement: boolean) => {
      if (!node) return;
      const m = node.Match || {};
      const t1 = m.FirstTeamText || '';
      const t2 = m.SecondTeamText || '';
      if (!t1 && !t2) return;
      if (m.ScheduledStartDateTime && fmtTime(m.ScheduledStartDateTime)) startRaws.push(m.ScheduledStartDateTime);
      if (!matchesByDepth[depth]) matchesByDepth[depth] = [];
      if (depth > maxDepth) maxDepth = depth;
      matchesByDepth[depth].push({
        matchName: m.FullName || '',
        team1: formatTeamDisplay(t1),
        team2: formatTeamDisplay(t2),
        court: m.Court?.Name || '',
        time: fmtTime(m.ScheduledStartDateTime || ''),
        isPlacement,
        hasUs: isOurTeamRef(t1) || isOurTeamRef(t2),
      });
      walkTree(node.TopSource, depth + 1, isPlacement);
      walkTree(node.BottomSource, depth + 1, isPlacement);
    };

    const roots = play.Roots || [];
    // First root is typically the championship match tree
    if (roots[0]) walkTree(roots[0], 0, false);
    // Remaining roots are placement matches (losers brackets)
    for (let ri = 1; ri < roots.length; ri++) {
      walkTree(roots[ri], 0, true);
    }

    // Build rounds from deepest (first round) to shallowest (finals)
    const rounds: BracketRound[] = [];
    const roundNames = (depth: number): string => {
      const fromFinal = depth;  // 0 = final, 1 = semi, 2 = quarter, etc.
      if (fromFinal === 0) return 'Finals';
      if (fromFinal === 1) return 'Semifinals';
      if (fromFinal === 2) return 'Quarterfinals';
      return `Round of ${Math.pow(2, fromFinal + 1)}`;
    };

    // Championship rounds (deepest first = earliest round)
    for (let d = maxDepth; d >= 0; d--) {
      const matches = (matchesByDepth[d] || []).filter(m => !m.isPlacement);
      if (matches.length > 0) {
        rounds.push({ label: roundNames(d), matches });
      }
    }

    // Placement matches
    const placementMatches = Object.values(matchesByDepth).flat().filter(m => m.isPlacement);
    if (placementMatches.length > 0) {
      rounds.push({ label: 'Placement', matches: placementMatches });
    }

    const leafCount = (matchesByDepth[maxDepth] || []).filter(m => !m.isPlacement).length;
    startRaws.sort();
    bracketTrees[bracketName] = { rounds, teamCount: leafCount * 2, startTime: startRaws.length ? fmtTime(startRaws[0]) : bracketTime };

    // Get all leaf matchups for pool-rank mapping
    const allLeafMatchups: LeafMatchup[] = [];
    for (const r of roots) {
      allLeafMatchups.push(...getLeafMatchups(r));
    }

    // Parse each team text and map pool references to this bracket
    for (const matchup of allLeafMatchups) {
      const t1Ref = parsePoolRef(matchup.t1);
      const t2Ref = parsePoolRef(matchup.t2);

      // Extract seed from parenthetical suffix: "1st-R1 D1 Pool 1  (1)" → seed 1
      const t1Seed = matchup.t1.match(/\((\d+)\)\s*$/)?.[1];
      const t2Seed = matchup.t2.match(/\((\d+)\)\s*$/)?.[1];

      if (t1Ref) {
        const key = `${t1Ref.poolNum}_${t1Ref.rank}`;
        if (!poolRankToBracket[key]) {
          poolRankToBracket[key] = {
            bracketName, court: matchup.court || bracketCourt,
            time: fmtTime(matchup.time) || bracketTime, date: bracketDate,
            matchups: allLeafMatchups.map(lm => ({ t1: lm.t1, t2: lm.t2, t1Pool: parsePoolRef(lm.t1), t2Pool: parsePoolRef(lm.t2), court: lm.court, time: lm.time })),
            seed: t1Seed ? parseInt(t1Seed) : null,
            opponentRef: matchup.t2 || null,
          };
        }
      }
      if (t2Ref) {
        const key = `${t2Ref.poolNum}_${t2Ref.rank}`;
        if (!poolRankToBracket[key]) {
          poolRankToBracket[key] = {
            bracketName, court: matchup.court || bracketCourt,
            time: fmtTime(matchup.time) || bracketTime, date: bracketDate,
            matchups: allLeafMatchups.map(lm => ({ t1: lm.t1, t2: lm.t2, t1Pool: parsePoolRef(lm.t1), t2Pool: parsePoolRef(lm.t2), court: lm.court, time: lm.time })),
            seed: t2Seed ? parseInt(t2Seed) : null,
            opponentRef: matchup.t1 || null,
          };
        }
      }
    }
  }

  // Also try matching by team name/code for completed pool play
  function findBracketForTeam(teamText: string, name: string): { bracketName: string; court: string; time: string; date: string } | null {
    for (const { date, play } of allBrackets) {
      const sources = extractAllSources(play);
      for (const source of sources) {
        if (source === teamText || stripLocationCode(source) === stripLocationCode(teamText) ||
            stripAllSuffixes(source) === stripAllSuffixes(teamText) ||
            (name && (source.includes(name) || stripLocationCode(source) === name))) {
          const rootMatch = play.Roots?.[0]?.Match;
          return {
            bracketName: play.FullName || play.CompleteFullName,
            court: rootMatch?.Court?.Name || '',
            time: fmtTime(rootMatch?.ScheduledStartDateTime || ''),
            date: fmtDate(rootMatch?.ScheduledStartDateTime || date),
          };
        }
      }
    }
    return null;
  }

  // Build future paths for each pool rank (1st through last)
  const futurePaths: FuturePath[] = [];
  const poolSize = rawTeams.length;
  for (let poolRank = 1; poolRank <= poolSize; poolRank++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const teamAtRank: any = sortedStandings[poolRank - 1];
    const isUs = teamAtRank?.TeamCode?.toLowerCase() === teamCode.toLowerCase();
    const poolPlayComplete = teamAtRank?.FinishRank !== null;
    const finishText = `${ordinal(poolRank)} in Pool`;
    const displayTeamName = poolPlayComplete ? (teamAtRank?.TeamName || '') : `${ordinal(poolRank)} place (TBD)`;

    // Look up bracket from our pool-rank-to-bracket map
    const mapKey = `${poolNumber}_${poolRank}`;
    const mappedBracket = poolRankToBracket[mapKey];

    // Fallback: if pool play is complete, search by team name
    let bracketInfo: { bracketName: string; court: string; time: string; date: string } | null = null;
    if (mappedBracket) {
      bracketInfo = { bracketName: mappedBracket.bracketName, court: mappedBracket.court, time: mappedBracket.time, date: mappedBracket.date };
    } else if (poolPlayComplete && teamAtRank) {
      const teamText = teamAtRank.TeamText || teamAtRank.TeamName || '';
      bracketInfo = findBracketForTeam(teamText, teamAtRank.TeamName);
    }

    // Determine finish range with ranking prediction
    let finishRange = '';
    if (bracketInfo) {
      const range = bracketFinishRanges[bracketInfo.bracketName];
      if (range) {
        finishRange = `${bracketInfo.bracketName}\nFinish: ${ordinal(range.best)} – ${ordinal(range.worst)} overall`;
      } else {
        finishRange = bracketInfo.bracketName;
      }
    } else {
      finishRange = 'Bracket TBD';
    }

    // Find opponent in bracket (from the leaf matchup)
    let opponentResolved = '';
    if (mappedBracket?.opponentRef) {
      // Parse opponent reference - could be a pool ref or actual team
      const oppPoolRef = parsePoolRef(mappedBracket.opponentRef);
      if (oppPoolRef) {
        // Find which team is at that pool/rank (if pool play is complete)
        const oppPool = allDaysPlays.flatMap(d => d.plays).filter((p: { PlayType: number }) => p.PlayType === 0)
          .find((p: { FullName: string }) => p.FullName?.match(/Pool (\d+)/)?.[1] === oppPoolRef.poolNum);
        if (oppPool) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const oppTeams = [...(oppPool.Teams || [])].sort((a: any, b: any) => (a.FinishRank ?? 99) - (b.FinishRank ?? 99));
          const oppTeam = oppTeams[oppPoolRef.rank - 1];
          if (oppTeam?.FinishRank !== null && oppTeam?.FinishRank !== undefined) {
            opponentResolved = oppTeam.TeamName;
          } else {
            opponentResolved = `${ordinal(oppPoolRef.rank)} in Pool ${oppPoolRef.poolNum}`;
          }
        } else {
          opponentResolved = `${ordinal(oppPoolRef.rank)} in Pool ${oppPoolRef.poolNum}`;
        }
      } else if (!mappedBracket.opponentRef.startsWith('Loser of') && !mappedBracket.opponentRef.startsWith('Winner of')) {
        opponentResolved = stripAllSuffixes(mappedBracket.opponentRef);
      }
    } else if (bracketInfo && poolPlayComplete && teamAtRank) {
      // Search bracket tree for opponent by team name
      const teamText = teamAtRank.TeamText || teamAtRank.TeamName || '';
      for (const { play } of allBrackets) {
        if (play.FullName !== bracketInfo.bracketName) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const checkNode = (node: any): string => {
          if (!node) return '';
          const nm = node.Match || {};
          const nt1: string = nm.FirstTeamText || '';
          const nt2: string = nm.SecondTeamText || '';
          if (stripLocationCode(nt1) === stripLocationCode(teamText) || nt1.includes(teamAtRank.TeamName)) {
            return stripLocationCode(nt2);
          }
          if (stripLocationCode(nt2) === stripLocationCode(teamText) || nt2.includes(teamAtRank.TeamName)) {
            return stripLocationCode(nt1);
          }
          return checkNode(node.TopSource) || checkNode(node.BottomSource);
        };
        for (const r of (play.Roots || [])) {
          opponentResolved = checkNode(r) || checkNode(r.TopSource) || checkNode(r.BottomSource);
          if (opponentResolved) break;
        }
        break;
      }
    }

    // Get full bracket tree for display
    const bracketRounds = bracketInfo ? (bracketTrees[bracketInfo.bracketName]?.rounds || []) : [];
    const bracketTeamCount = bracketInfo ? (bracketTrees[bracketInfo.bracketName]?.teamCount || 0) : 0;

    futurePaths.push({
      finishText,
      rank: poolRank,
      isUs,
      teamAtRank: displayTeamName,
      nextPlay: bracketInfo?.bracketName || 'TBD',
      nextPlayShort: bracketInfo?.bracketName || 'TBD',
      court: bracketInfo?.court || '',
      time: (bracketInfo && bracketTrees[bracketInfo.bracketName]?.startTime) || bracketInfo?.time || '',
      bracketDate: bracketInfo?.date || '',
      workCourt: '',
      workTime: '',
      opponentResolved,
      finishRange,
      seed: mappedBracket?.seed ?? null,
      bracketRounds,
      bracketTeamCount,
    });
  }

  return { futurePaths, bracketTrees };
}
