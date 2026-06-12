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

export function buildFinalStandings(finalDay: DayPlays | undefined, teamName: string): FinalStanding[] {
  let finalStandings: FinalStanding[] = [];
  if (!finalDay) return finalStandings;

  const finalPlays = finalDay.plays.filter((p: { PlayType: number }) => p.PlayType === 1);

  // Step 1: Parse all bracket entries
  type ParsedEntry = { bracketRank: number; teamName: string; explicitOverallRank: number | null; bracketName: string; tier: string };
  const allParsedEntries: ParsedEntry[] = [];
  let hasAnyExplicitRanks = false;

  const seenTeams = new Set<string>();
  for (const play of finalPlays) {
    const bracketName = play.FullName || '';
    // Skip placement-refinement brackets (e.g. "5th Pl Bracket") — their
    // teams already hold ranks in an earlier bracket
    if (isRefinementBracket(play, seenTeams)) continue;
    for (const n of rankedTeamNames(play)) seenTeams.add(n);
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
      const entryTeamName = stripLocationCode(teamNameRaw);
      // Skip placeholder entries (unplayed tournament)
      if (entryTeamName.startsWith('Winner of') || entryTeamName.startsWith('Loser of')) continue;
      allParsedEntries.push({ bracketRank, teamName: entryTeamName, explicitOverallRank, bracketName, tier });
    }
  }

  const isUsEntry = (entry: ParsedEntry) =>
    entry.teamName === teamName || stripLocationCode(entry.teamName).toLowerCase() === teamName.toLowerCase();

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
