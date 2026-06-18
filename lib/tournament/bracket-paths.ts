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
  poolKey: string;
}

// Normalize a pool identity to a comparison key that keeps round/group/
// division context, so "Pool 30" in Round 1 can't be confused with Pool 30 in
// Round 3 Group 4. Works on both a pool's CompleteFullName ("Round 3 Group 1
// Pool 6") and a bracket seed token ("R3G1P6") — both normalize to "R3G1P6".
export function normalizePoolKey(s: string): string {
  return (s || '')
    .toUpperCase()
    .replace(/\bROUND\b/g, 'R')
    .replace(/\bGROUP\b/g, 'G')
    .replace(/\bDIVISION\b/g, 'D')
    .replace(/\bPOOL\b/g, 'P')
    .replace(/[^A-Z0-9]/g, '');
}

// Pull the pool identity out of a seed reference by removing the rank prefix
// ("1st-"), any "place" wording, a trailing seed number ("(1)"), and a
// trailing reverse-format ordinal ("Pool 1 - 1st"), then normalize the rest.
function poolKeyFromRef(text: string): string {
  const body = text
    .replace(/^\s*\d+(?:st|nd|rd|th)\b[\s-]*/i, '')
    .replace(/\bplace\b/ig, '')
    .replace(/\(\d+\)\s*$/, '')
    .replace(/[\s-]*\d+(?:st|nd|rd|th)\s*$/i, '')
    .trim();
  return normalizePoolKey(body);
}

// Parse pool rank reference from a bracket team text.
// AES uses inconsistent formats across tournaments, so we try multiple patterns:
//   "1st-R1 D1 Pool 1  (1)"  → { rank: 1, poolNum: "1",  poolKey: "R1D1P1" }
//   "2nd-P5"                  → { rank: 2, poolNum: "5",  poolKey: "P5" }
//   "1st-R3G4P30"            → { rank: 1, poolNum: "30", poolKey: "R3G4P30" }
//   "1st Place Pool 2"       → { rank: 1, poolNum: "2",  poolKey: "P2" }
//   "Pool 1 - 1st"           → { rank: 1, poolNum: "1",  poolKey: "P1" }
export function parsePoolRef(text: string): PoolRef | null {
  const base = (() => {
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
  })();
  if (!base) return null;
  return { ...base, poolKey: poolKeyFromRef(text) };
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

// A bracket reached not directly from a pool finish but by winning/losing an
// earlier bracket (e.g. Win Challenge 4 → Championship Division). Lets the UI
// show the full predicted path through multi-stage formats.
export interface ChainedBracket {
  bracketName: string;
  via: string;            // how it's reached, e.g. "Win Challenge 4 · Win Challenge 6"
  bracketDate: string;
  time: string;
  bracketRounds: BracketRound[];
  bracketTeamCount: number;
  finishRange: string;
}

// One card in the Bracket Play section. Covers every ranked division in the
// event (so you can see how everyone finishes), plus the team's own
// intermediate brackets. `relation` marks the team's path for highlighting.
export interface BracketCard {
  bracketName: string;
  finishRange: string;     // "34th – 39th overall", or '' for intermediate brackets
  bracketDate: string;
  time: string;
  teamCount: number;
  bracketRounds: BracketRound[];
  relation: 'direct' | 'chained' | 'other';
  detail: string;          // "Our pool → 3rd in Pool" / "Reached by → Win Challenge 4" / ''
  sortKey: number;         // intermediates first, then divisions by best finish rank
}

export interface BracketPathsInput {
  allBrackets: BracketEntry[];
  allDaysPlays: DayPlays[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawTeams: any[];
  teamCode: string;
  teamName: string;
  poolKey: string;
  bracketFinishRanges: FinishRangeMap;
}

export function buildBracketPaths(input: BracketPathsInput): {
  futurePaths: FuturePath[];
  bracketTrees: Record<string, { rounds: BracketRound[]; teamCount: number; startTime: string; date: string }>;
  chainedPaths: ChainedBracket[];
  bracketCards: BracketCard[];
} {
  const { allBrackets, allDaysPlays, rawTeams, teamCode, teamName, poolKey, bracketFinishRanges } = input;

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
  const bracketTrees: Record<string, { rounds: BracketRound[]; teamCount: number; startTime: string; date: string }> = {};

  // Helper: format a team text reference into a display-friendly name
  const formatTeamDisplay = (text: string): string => {
    if (!text) return 'TBD';
    if (text.startsWith('Winner of') || text.startsWith('Loser of')) return text;
    const ref = parsePoolRef(text);
    if (ref) {
      // Check if pool play is done for this pool — try to resolve to actual team.
      // Match by full pool key (round/group aware) so we resolve against the
      // right pool, not just any pool sharing the number.
      const pool = allDaysPlays.flatMap(d => d.plays).filter((p: { PlayType: number }) => p.PlayType === 0)
        .find((p: { CompleteFullName?: string; FullName?: string }) => normalizePoolKey(p.CompleteFullName || p.FullName || '') === ref.poolKey);
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
    if (ref && ref.poolKey === poolKey) {
      // Could be any of our pool ranks — mark for ALL our possible positions
      return true;
    }
    // Check actual team name
    if (text.toLowerCase().includes(teamCode.toLowerCase())) return true;
    const stripped = stripAllSuffixes(text).toLowerCase();
    if (stripped === teamName.toLowerCase()) return true;
    return false;
  };

  // Index brackets by ShortName (longest first) to resolve cross-bracket feed
  // references like "Winner of R4Challenge4M1" → the "Challenge 4" bracket.
  const byShort = allBrackets
    .map(({ play }) => ({ short: (play.ShortName || '').toUpperCase(), full: play.FullName || play.CompleteFullName }))
    .filter(b => b.short)
    .sort((a, b) => b.short.length - a.short.length);
  // advances[sourceBracket] = where its match winner / loser goes next
  const advances: Record<string, { Winner?: string; Loser?: string }> = {};
  const resolveFeed = (text: string): { outcome: 'Winner' | 'Loser'; sourceFull: string } | null => {
    const m = (text || '').match(/^(Winner|Loser) of (.+)$/i);
    if (!m) return null;
    const token = m[2].replace(/M\d+\s*$/i, '').toUpperCase();
    const src = byShort.find(b => token.endsWith(b.short));
    if (!src) return null;
    return { outcome: m[1].toLowerCase() === 'winner' ? 'Winner' : 'Loser', sourceFull: src.full };
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
    bracketTrees[bracketName] = { rounds, teamCount: leafCount * 2, startTime: startRaws.length ? fmtTime(startRaws[0]) : bracketTime, date: bracketDate };

    // Get all leaf matchups for pool-rank mapping
    const allLeafMatchups: LeafMatchup[] = [];
    for (const r of roots) {
      allLeafMatchups.push(...getLeafMatchups(r));
    }

    // Record which earlier bracket's winner/loser feeds into this one
    for (const lm of allLeafMatchups) {
      for (const t of [lm.t1, lm.t2]) {
        const feed = resolveFeed(t);
        if (feed) {
          if (!advances[feed.sourceFull]) advances[feed.sourceFull] = {};
          advances[feed.sourceFull][feed.outcome] = bracketName;
        }
      }
    }

    // Parse each team text and map pool references to this bracket
    for (const matchup of allLeafMatchups) {
      const t1Ref = parsePoolRef(matchup.t1);
      const t2Ref = parsePoolRef(matchup.t2);

      // Extract seed from parenthetical suffix: "1st-R1 D1 Pool 1  (1)" → seed 1
      const t1Seed = matchup.t1.match(/\((\d+)\)\s*$/)?.[1];
      const t2Seed = matchup.t2.match(/\((\d+)\)\s*$/)?.[1];

      if (t1Ref) {
        const key = `${t1Ref.poolKey}_${t1Ref.rank}`;
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
        const key = `${t2Ref.poolKey}_${t2Ref.rank}`;
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
    const mapKey = `${poolKey}_${poolRank}`;
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
          .find((p: { CompleteFullName?: string; FullName?: string }) => normalizePoolKey(p.CompleteFullName || p.FullName || '') === oppPoolRef.poolKey);
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

  // Follow win/lose feeds from each immediate bracket to its onward brackets,
  // so multi-stage formats (pool → Challenge → Division) show the full path.
  // Terminal brackets (e.g. Gold in a one-hop event) have no feeds, so this is
  // empty there and the display is unchanged.
  const immediate = new Set(futurePaths.map(f => f.nextPlay).filter(n => n && n !== 'TBD'));
  const chainedVia = new Map<string, Set<string>>();
  const visited = new Set<string>(immediate);
  const queue = [...immediate];
  while (queue.length) {
    const cur = queue.shift()!;
    const adv = advances[cur];
    if (!adv) continue;
    for (const outcome of ['Winner', 'Loser'] as const) {
      const dest = adv[outcome];
      if (!dest) continue;
      if (!immediate.has(dest)) {
        if (!chainedVia.has(dest)) chainedVia.set(dest, new Set());
        chainedVia.get(dest)!.add(`${outcome === 'Winner' ? 'Win' : 'Lose'} ${cur}`);
      }
      if (!visited.has(dest)) { visited.add(dest); queue.push(dest); }
    }
  }
  const chainedPaths: ChainedBracket[] = [...chainedVia.entries()].map(([name, vias]) => {
    const tree = bracketTrees[name];
    const range = bracketFinishRanges[name];
    return {
      bracketName: name,
      via: [...vias].join(' · '),
      bracketDate: tree?.date || '',
      time: tree?.startTime || '',
      bracketRounds: tree?.rounds || [],
      bracketTeamCount: tree?.teamCount || 0,
      finishRange: range ? `Finish: ${ordinal(range.best)} – ${ordinal(range.worst)} overall` : '',
    };
  });

  // Unified, sorted card list for the Bracket Play section: every ranked
  // division in the event, plus the team's own intermediate brackets. Divisions
  // not on the team's path are included as 'other' so the full finish ladder is
  // visible (no apparent gaps).
  const directByBracket: Record<string, FuturePath[]> = {};
  for (const f of futurePaths) {
    if (!f.nextPlay || f.nextPlay === 'TBD') continue;
    if (!directByBracket[f.nextPlay]) directByBracket[f.nextPlay] = [];
    directByBracket[f.nextPlay].push(f);
  }
  const chainedByName = new Map(chainedPaths.map(c => [c.bracketName, c]));
  const intermediateOrder = futurePaths.map(f => f.nextPlay);

  const bracketCards: BracketCard[] = [];
  for (const name of Object.keys(bracketTrees)) {
    const tree = bracketTrees[name];
    const range = bracketFinishRanges[name];
    const direct = directByBracket[name];
    const chained = chainedByName.get(name);
    let relation: 'direct' | 'chained' | 'other' = 'other';
    let detail = '';
    if (direct) { relation = 'direct'; detail = `Our pool → ${direct.map(f => f.finishText).join(', ')}`; }
    else if (chained) { relation = 'chained'; detail = `Reached by → ${chained.via}`; }

    if (range) {
      bracketCards.push({
        bracketName: name,
        finishRange: `${ordinal(range.best)} – ${ordinal(range.worst)} overall`,
        bracketDate: tree.date, time: tree.startTime, teamCount: tree.teamCount,
        bracketRounds: tree.rounds, relation, detail, sortKey: 1000 + range.best,
      });
    } else if (relation !== 'other') {
      // Team's intermediate bracket (Challenge/Crossover) — no final rank yet;
      // list first, in pool-finish order
      const idx = intermediateOrder.indexOf(name);
      bracketCards.push({
        bracketName: name, finishRange: '',
        bracketDate: tree.date, time: tree.startTime, teamCount: tree.teamCount,
        bracketRounds: tree.rounds, relation, detail, sortKey: idx >= 0 ? idx : 500,
      });
    }
  }
  bracketCards.sort((a, b) => a.sortKey - b.sortKey);

  return { futurePaths, bracketTrees, chainedPaths, bracketCards };
}
