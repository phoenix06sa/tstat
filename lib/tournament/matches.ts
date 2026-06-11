// Team match list (pool + bracket, chronological) and work/ref assignments.
// Sources: /schedule/past (completed, always available) merged with
// /schedule/current (upcoming/in-progress), deduped by MatchId.

import { fmtTime, fmtDate } from '@/lib/aes';

export interface SetScore {
  us: number | null;
  them: number | null;
}

export interface TeamMatch {
  matchName: string;
  time: string;
  date: string;
  court: string;
  opponent: string;
  opponentCode: string;
  workTeam: string;
  hasScores: boolean;
  sets: SetScore[];
  weWon: boolean | null;
  isPoolPlay: boolean;
  timestamp: number;
}

export interface WorkAssignment {
  play: string;
  time: string;
  date: string;
  court: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildMatches(past: any, current: any, teamId: string): TeamMatch[] {
  const matches: TeamMatch[] = [];
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
      const iFirst = m.FirstTeamId === Number(teamId);
      addMatch(m, playType, iFirst);
    }
  }

  // Current matches (upcoming/in-progress)
  if (current) {
    for (const block of current) {
      const playType = block.Play?.Type ?? 0;
      for (const m of (block.Matches || [])) {
        const iFirst = m.FirstTeamId === Number(teamId);
        addMatch(m, playType, iFirst);
      }
    }
  }

  matches.sort((a, b) => a.timestamp - b.timestamp);
  return matches;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildWorkAssignments(work: any): WorkAssignment[] {
  const workAssignments: WorkAssignment[] = [];
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
  return workAssignments;
}
