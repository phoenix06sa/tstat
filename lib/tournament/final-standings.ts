// Final standings from the last day's brackets using RankText.
// In a single-elimination bracket, teams that lose in the same round are tied.
// Sibling brackets (e.g. Silver A + Silver B) share a base offset, and teams
// at the same elimination round across siblings are also tied.

import { stripLocationCode } from '@/lib/aes';
import { isRefinementBracket, rankedTeamNames, placementAnchor } from './bracket-paths';
import type { DayPlays } from './types';

export interface FinalStanding {
  overallRank: number;
  tied: boolean;
  teamName: string;
  teamCode: string;
  bracket: string;
  bracketRank: number;
  isUs: boolean;
}

// Convert sequential bracket rank to elimination-bracket tied rank.
// e.g. in a 16-team bracket: ranks 9-16 all lose in round 1 → tied at 9th.
// Used only as a fallback when a bracket has no scored matches to derive
// ties from (see computeBracketPlaces).
function eliminationTiedRank(bracketRank: number): number {
  if (bracketRank <= 2) return bracketRank;
  return Math.pow(2, Math.floor(Math.log2(bracketRank - 1))) + 1;
}

// Derive each team's finish place within a bracket.
//
// The coarse tier comes from elimination depth (the round formula): 1, 2,
// 3rd–4th, 5th–8th, 9th–16th, … This is depth-aware — a finalist always
// outranks a semifinalist even if they never met.
//
// Head-to-head results then REFINE *within* a tier only. AES plays
// consolation/placement matches that split same-round losers (e.g. the four
// quarterfinal losers play off into 5th–6th and 7th–8th, or a 3rd-place match
// separates the two semifinal losers). Within each tier we take the
// transitive closure of the "winner beats loser" relation and split teams
// whose order a match actually decided; teams no match separated stay tied.
// Refinement never crosses tiers, so it can't tie a finalist with a
// semifinalist. Returns normalized team name → place (e.g. 1,2,3,3,5,5,7,7
// for an 8-team bracket with the 3rd-place match unplayed and two consolations).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeBracketPlaces(play: any): Map<string, number> {
  const norm = (s: string) => stripLocationCode(s || '').trim().toLowerCase();
  const isPlaceholder = (s: string) => !s || s.startsWith('winner of') || s.startsWith('loser of');

  // Collect "winner beats loser" edges from every scored match in the tree
  const beats = new Map<string, Set<string>>();
  const addEdge = (w: string, l: string) => {
    if (!beats.has(w)) beats.set(w, new Set());
    beats.get(w)!.add(l);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (node: any) => {
    if (!node) return;
    const m = node.Match || {};
    if (m.HasScores) {
      const t1 = norm(m.FirstTeam?.Name || m.FirstTeamText);
      const t2 = norm(m.SecondTeam?.Name || m.SecondTeamText);
      if (t1 && t2 && !isPlaceholder(t1) && !isPlaceholder(t2)) {
        if (m.FirstTeamWon) addEdge(t1, t2);
        else if (m.SecondTeamWon) addEdge(t2, t1);
      }
    }
    walk(node.TopSource);
    walk(node.BottomSource);
  };
  for (const r of (play.Roots || [])) walk(r);

  // Transitive closure (team counts are tiny, so repeated expansion is fine)
  const nodes = new Set<string>(beats.keys());
  for (const s of beats.values()) for (const x of s) nodes.add(x);
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of nodes) {
      const sa = beats.get(a);
      if (!sa) continue;
      for (const b of [...sa]) {
        const sb = beats.get(b);
        if (!sb) continue;
        for (const c of sb) if (!sa.has(c)) { sa.add(c); changed = true; }
      }
    }
  }
  const aheadOf = (a: string, b: string) => beats.get(a)?.has(b) || false;

  // Teams in AES's RankText order
  const ranked: { rank: number; name: string }[] = [];
  for (const f of (play.FutureRoundMatches || [])) {
    const mm = (f.RankText || '').match(/^(\d+)\s*-\s*(.+)$/);
    if (!mm) continue;
    const name = norm(mm[2].trim().replace(/\s*\(\d+\)\s*$/, ''));
    if (isPlaceholder(name)) continue;
    ranked.push({ rank: parseInt(mm[1]), name });
  }
  ranked.sort((a, b) => a.rank - b.rank);

  // Coarse tiers by elimination depth; ranked[] is already in rank order so
  // each tier's members stay rank-ordered
  const byTier = new Map<number, string[]>();
  for (const t of ranked) {
    const base = eliminationTiedRank(t.rank);
    if (!byTier.has(base)) byTier.set(base, []);
    byTier.get(base)!.push(t.name);
  }

  // Within each tier, split into sub-groups using head-to-head results: a new
  // sub-group starts as soon as someone already in the current one is ahead.
  // place = tier base + (members of the tier ranked strictly ahead).
  const places = new Map<string, number>();
  for (const [base, members] of byTier) {
    let groupStart = 0;
    for (let i = 0; i < members.length; i++) {
      if (i > 0) {
        let ordered = false;
        for (let j = groupStart; j < i; j++) {
          if (aheadOf(members[j], members[i])) { ordered = true; break; }
        }
        if (ordered) groupStart = i;
      }
      places.set(members[i], base + groupStart);
    }
  }
  return places;
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

export function buildFinalStandings(finalDay: DayPlays | undefined, teamName: string): FinalStanding[] {
  let finalStandings: FinalStanding[] = [];
  if (!finalDay) return finalStandings;

  const finalPlays = finalDay.plays.filter((p: { PlayType: number }) => p.PlayType === 1);

  // Step 1: Parse all bracket entries
  type ParsedEntry = { bracketRank: number; bracketPlace: number; teamName: string; explicitOverallRank: number | null; bracketName: string; tier: string };
  const allParsedEntries: ParsedEntry[] = [];

  const seenTeams = new Set<string>();
  for (const play of finalPlays) {
    const bracketName = play.FullName || '';
    // Skip placement-refinement brackets (e.g. "5th Pl Bracket") — their
    // teams already hold ranks in an earlier bracket
    if (isRefinementBracket(play, seenTeams)) continue;
    for (const n of rankedTeamNames(play)) seenTeams.add(n);
    const tier = bracketTier(bracketName);
    // Finish places derived from actual results (ties where no match decided
    // the order); falls back to the round formula for unplayed brackets
    const places = computeBracketPlaces(play);
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
      // Strip location code
      const entryTeamName = stripLocationCode(teamNameRaw);
      // Skip placeholder entries (unplayed tournament)
      if (entryTeamName.startsWith('Winner of') || entryTeamName.startsWith('Loser of')) continue;
      const bracketPlace = places.get(entryTeamName.toLowerCase()) ?? eliminationTiedRank(bracketRank);
      allParsedEntries.push({ bracketRank, bracketPlace, teamName: entryTeamName, explicitOverallRank, bracketName, tier });
    }
  }

  const isUsEntry = (entry: ParsedEntry) =>
    entry.teamName === teamName || stripLocationCode(entry.teamName).toLowerCase() === teamName.toLowerCase();

  // The trailing "(N)" after a team is an explicit OVERALL rank in some events
  // (e.g. Lone Star Regionals), but a SEED in others (USAV JNCs). Tell them
  // apart by finish-consistency: a true overall rank improves (gets smaller)
  // as the bracket finish improves, so within a bracket it never runs backwards
  // against bracket order. If any bracket's numbers decrease as finish worsens,
  // they're seeds — ignore them and fall back to elimination-tier ranking, which
  // correctly ties sibling-bracket winners (Silver A 1st = Silver B 1st = 9th).
  const byBracketName = new Map<string, ParsedEntry[]>();
  for (const e of allParsedEntries) {
    if (!byBracketName.has(e.bracketName)) byBracketName.set(e.bracketName, []);
    byBracketName.get(e.bracketName)!.push(e);
  }
  let anyExplicit = false;
  let explicitFinishConsistent = true;
  for (const entries of byBracketName.values()) {
    const withRank = entries
      .filter(e => e.explicitOverallRank !== null)
      .sort((a, b) => a.bracketRank - b.bracketRank);
    if (withRank.length === 0) continue;
    anyExplicit = true;
    for (let i = 1; i < withRank.length; i++) {
      if ((withRank[i].explicitOverallRank as number) < (withRank[i - 1].explicitOverallRank as number)) {
        explicitFinishConsistent = false;
        break;
      }
    }
  }
  const useExplicitRanks = anyExplicit && explicitFinishConsistent;

  if (useExplicitRanks) {
    // Tournament provides explicit overall ranks (e.g. Lone Star Regionals)
    for (const entry of allParsedEntries) {
      finalStandings.push({
        overallRank: entry.explicitOverallRank ?? entry.bracketRank,
        tied: false,
        teamName: entry.teamName,
        teamCode: '',
        bracket: entry.bracketName,
        bracketRank: entry.bracketRank,
        isUs: isUsEntry(entry),
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

      // "Nth Place" tiers anchor at rank N, leaving a gap for placements
      // decided without a final-day bracket (e.g. 3rd/4th)
      const anchor = siblings.map(b => placementAnchor(b.bracketName)).find(a => a !== null);
      if (anchor && anchor - 1 > baseOffset) baseOffset = anchor - 1;

      // Collect all unique elimination tied ranks in this tier
      const tiedRankGroups: Map<number, ParsedEntry[]> = new Map();
      for (const bracket of siblings) {
        for (const entry of bracket.entries) {
          const tr = entry.bracketPlace;
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
            isUs: isUsEntry(entry),
          });
        }

        teamsBeforeThisGroup += groupEntries.length;
      }

      // Advance base offset by total teams in this tier
      const totalTeamsInTier = siblings.reduce((sum, b) => sum + b.entries.length, 0);
      baseOffset += totalTeamsInTier;
    }
  }

  // Deduplicate by team name — entries were pushed in tier order, so the
  // first (highest) placement wins if a team somehow appears twice
  const seen = new Set<string>();
  finalStandings = finalStandings.filter(s => {
    const key = s.teamName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  // Sort by overall rank, then bracket name for ties
  finalStandings.sort((a, b) => a.overallRank - b.overallRank || a.bracket.localeCompare(b.bracket));
  return finalStandings;
}
