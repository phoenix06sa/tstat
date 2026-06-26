// Pool standings with tiebreaker explanations.
// AES breaks pool ties by: match win % → set win % → point ratio.

export interface PoolStanding {
  teamName: string;
  teamCode: string;
  isUs: boolean;
  matchesWon: number;
  matchesLost: number;
  setsWon: number;
  setsLost: number;
  matchPct: string;
  setPercent: number | null;
  pointRatio: number | null;
  finishRank: number | null;
  overallRank: number | null;
  finishRankText: string;
  tiebreaker: string | null;
}

// Rank two pool teams. Use the official FinishRank once it's posted; until then
// (live pool play) FinishRank is null, so fall back to AES's tiebreaker order:
// match win % → set win % → point ratio. Without this, live standings/projections
// fall back to the raw AES slot order — a 3-0 team can show below a 1-2 team.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function comparePoolTeams(a: any, b: any): number {
  const fa = a.FinishRank ?? null;
  const fb = b.FinishRank ?? null;
  if (fa !== null && fb !== null && fa !== fb) return fa - fb;
  if (fa !== null && fb === null) return -1;
  if (fa === null && fb !== null) return 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const winPct = (t: any) => {
    const tot = (t.MatchesWon || 0) + (t.MatchesLost || 0);
    return tot ? t.MatchesWon / tot : 0;
  };
  if (winPct(a) !== winPct(b)) return winPct(b) - winPct(a);
  const sa = a.SetPercent ?? 0, sb = b.SetPercent ?? 0;
  if (sa !== sb) return sb - sa;
  const pa = a.PointRatio ?? 0, pb = b.PointRatio ?? 0;
  if (pa !== pb) return pb - pa;
  return 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildPoolStandings(rawTeams: any[], teamCode: string): PoolStanding[] {
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
        tiebreakers[t.TeamCode] = `Tied ${record} on matches, ranked by set % (${t.SetPercent !== null ? (t.SetPercent * 100).toFixed(1) : 'N/A'}%)`;
      } else {
        tiebreakers[t.TeamCode] = `Tied ${record} on matches + sets, ranked by point ratio (${t.PointRatio !== null && typeof t.PointRatio === 'number' ? t.PointRatio.toFixed(3) : 'N/A'})`;
      }
    }
  }

  return [...rawTeams].sort(comparePoolTeams).map((t) => ({
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
}
