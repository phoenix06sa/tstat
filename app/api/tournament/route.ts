import { NextResponse } from 'next/server';

const BASE = 'https://results.advancedeventsystems.com';
const EVENT = 'PTAwMDAwNDEyNDA90';
const DIV = '195174';
const TEAM_ID = '84723';
const TEAM_CODE = 'g14askyl2ls';
const TEAM_NAME = 'Austin Skyline 14 Black';

// Pool 6 is the opponent pool for our Saturday evening brackets
// ChBrkt#5: Pool 5 1st vs Pool 6 2nd
// ChBrkt#6: Pool 5 2nd vs Pool 6 1st
const OPPONENT_POOL_NAME = 'Pool 6';

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
  if (!res.ok) return null;
  return res.json();
}

function fmtTime(iso: string) {
  if (!iso) return '';
  const [, time] = iso.split('T');
  const [h, m] = time.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveOpponent(pool6Teams: any[], wantRank: number): string {
  // wantRank: 1 = 1st place, 2 = 2nd place from Pool 6
  const sorted = [...pool6Teams].sort((a, b) => {
    // If finishRank is set, use it
    if (a.FinishRank !== null && b.FinishRank !== null) return a.FinishRank - b.FinishRank;
    if (a.FinishRank !== null) return -1;
    if (b.FinishRank !== null) return 1;
    // Fall back to match wins
    if (a.MatchesWon !== b.MatchesWon) return b.MatchesWon - a.MatchesWon;
    return 0;
  });
  const team = sorted[wantRank - 1];
  if (!team) return `${wantRank === 1 ? '1st' : '2nd'} from Pool 6`;
  const isResolved = team.FinishRank !== null || team.MatchesWon > 0;
  if (!isResolved) return `${wantRank === 1 ? '1st' : '2nd'} from Pool 6 (TBD)`;
  const label = team.FinishRank !== null ? `(confirmed ${wantRank === 1 ? '1st' : '2nd'})` : `(leading ${wantRank === 1 ? '1st' : '2nd'})`;
  return `${team.TeamName} ${label}`;
}

export async function GET() {
  try {
    const [current, work, future, day1, day2] = await Promise.all([
      aes(`/api/event/${EVENT}/division/${DIV}/team/${TEAM_ID}/schedule/current`),
      aes(`/api/event/${EVENT}/division/${DIV}/team/${TEAM_ID}/schedule/work`),
      aes(`/api/event/${EVENT}/division/${DIV}/team/${TEAM_ID}/schedule/future`),
      aes(`/api/event/${EVENT}/division/${DIV}/plays/2026-05-09`),
      aes(`/api/event/${EVENT}/division/${DIV}/plays/2026-05-10`),
    ]);

    // --- Pool play matches ---
    const poolMatches: object[] = [];
    if (current) {
      for (const block of current) {
        for (const m of (block.Matches || [])) {
          const iFirst = m.FirstTeamId === Number(TEAM_ID);
          const opponent = iFirst ? m.SecondTeamName : m.FirstTeamName;
          const opponentCode = iFirst ? m.SecondTeamCode : m.FirstTeamCode;
          const ourWon = iFirst ? m.FirstTeamWon : m.SecondTeamWon;
          const sets: { us: number | null; them: number | null }[] = (m.Sets || []).map((s: { FirstTeamScore: number | null; SecondTeamScore: number | null }) => ({
            us: iFirst ? s.FirstTeamScore : s.SecondTeamScore,
            them: iFirst ? s.SecondTeamScore : s.FirstTeamScore,
          }));
          const hasScores = m.HasScores;
          poolMatches.push({
            matchName: m.MatchFullName,
            time: fmtTime(m.ScheduledStartDateTime),
            court: m.Court?.Name,
            opponent,
            opponentCode,
            workTeam: m.WorkTeamText,
            hasScores,
            sets,
            weWon: hasScores ? ourWon : null,
          });
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
          court: block.Match?.Court?.Name,
        });
      }
    }

    // --- Pool standings (our pool) + Pool 6 standings for opponent resolution ---
    let poolStandings: object[] = [];
    let poolName = '';
    let poolCourt = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pool6Teams: any[] = [];

    if (day1) {
      for (const play of day1) {
        const teams = play.Teams || [];
        const found = teams.find((t: { TeamCode: string }) => t.TeamCode?.toLowerCase() === TEAM_CODE.toLowerCase());
        if (found) {
          poolName = play.CompleteFullName || play.FullName;
          poolCourt = play.Courts?.[0]?.Name || '';
          poolStandings = teams.map((t: { TeamCode: string; TeamName: string; MatchesWon: number; MatchesLost: number; SetsWon: number; SetsLost: number; MatchPercent: string; FinishRank: number | null; OverallRank: number | null }) => ({
            teamName: t.TeamName,
            teamCode: t.TeamCode,
            isUs: t.TeamCode?.toLowerCase() === TEAM_CODE.toLowerCase(),
            matchesWon: t.MatchesWon,
            matchesLost: t.MatchesLost,
            setsWon: t.SetsWon,
            setsLost: t.SetsLost,
            matchPct: t.MatchPercent,
            finishRank: t.FinishRank,
            overallRank: t.OverallRank,
          }));
        }
        if (play.FullName === OPPONENT_POOL_NAME) {
          pool6Teams = play.Teams || [];
        }
      }
    }

    // --- Future paths ---
    // AES API only returns 1st and 2nd place paths (Saturday evening challenge brackets).
    // 3rd and 4th skip Saturday evening and go straight to Sunday lower brackets.
    //
    // Bracket seeding (cross-referenced from all pool future paths):
    //   ChBrkt#5: Pool 5 1st vs Pool 6 2nd  (GRB Ct 6 @ 6:30 PM Sat)
    //   ChBrkt#6: Pool 5 2nd vs Pool 6 1st  (GRB Ct 7 @ 6:30 PM Sat)
    //   3rd -> Bronze B Bracket             (GRB Ct 6 @ 8:30 AM Sun)
    //   4th -> Flight 1C Bracket            (GRB Ct 5 @ 9:30 AM Sun)
    const pool6Label = pool6Teams.length > 0
      ? pool6Teams.map((t: { TeamName: string }) => t.TeamName).join(' · ')
      : 'Austin Skyline 14 Royal · HOU STELLAR 14 ELITE · Tx Alpha Premier 14 Adidas · United VBA 14 Black';

    const futurePaths: object[] = [];
    if (future) {
      for (const f of future) {
        // 1st place faces Pool 6's 2nd; 2nd place faces Pool 6's 1st
        const opponentWantRank = f.PotentialRank === 1 ? 2 : 1;
        const opponentResolved = resolveOpponent(pool6Teams, opponentWantRank);
        const finishRange = 'Win -> Gold bracket (16 teams, top finishes)\nLose -> Silver C/D bracket (4 teams, mid-tier)';
        futurePaths.push({
          finishText: f.PotentialRankText,
          rank: f.PotentialRank,
          nextPlay: f.NextPlay?.CompleteFullName,
          nextPlayShort: f.NextPlay?.FullName,
          court: f.NextMatch?.Court?.Name,
          time: fmtTime(f.NextMatch?.ScheduledStartDateTime),
          workCourt: f.WorkMatch?.Court?.Name,
          workTime: fmtTime(f.WorkMatch?.ScheduledStartDateTime),
          saturdayEvening: true,
          opponentResolved,
          opponentPoolLabel: `Pool 6 (GRB Ct 11): ${pool6Label}`,
          finishRange,
        });
      }
    }

    // 3rd and 4th place — no Saturday evening match
    futurePaths.push({
      finishText: '3rd-P5',
      rank: 3,
      nextPlay: 'Round 3 Group 1 Bronze B Bracket (Sunday)',
      nextPlayShort: 'Bronze B Bracket',
      court: 'GRB Ct 6',
      time: '8:30 AM Sun',
      workCourt: 'GRB Ct 6',
      workTime: '9:30 AM Sun',
      saturdayEvening: false,
      note: 'No Saturday evening match — straight to Sunday Bronze B',
      finishRange: '4 teams · Bronze B bracket (mid-lower tier)',
    });
    futurePaths.push({
      finishText: '4th-P5',
      rank: 4,
      nextPlay: 'Round 3 Group 1 Flight 1C Bracket (Sunday)',
      nextPlayShort: 'Flight 1C Bracket',
      court: 'GRB Ct 5',
      time: '9:30 AM Sun',
      workCourt: 'GRB Ct 5',
      workTime: '10:30 AM Sun',
      saturdayEvening: false,
      note: 'No Saturday evening match — straight to Sunday Flight 1C',
      finishRange: '4 teams · Flight 1C bracket (lower tier)',
    });

    // --- Sunday bracket info (with live team seeding once populated) ---
    const sundayBrackets: object[] = [];
    if (day2) {
      for (const play of day2) {
        const teams = (play.Teams || []).map((t: { TeamName: string; TeamCode: string; FinishRank: number | null }) => ({
          teamName: t.TeamName,
          teamCode: t.TeamCode,
          isUs: t.TeamCode?.toLowerCase() === TEAM_CODE.toLowerCase(),
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

    return NextResponse.json({
      team: TEAM_NAME,
      teamCode: TEAM_CODE,
      event: '2026 Lone Star Regionals (12-14s)',
      venue: 'George R. Brown Convention Center',
      dates: 'May 9-10, 2026',
      division: '14 Bid',
      fetchedAt: new Date().toISOString(),
      poolName,
      poolCourt,
      poolStandings,
      poolMatches,
      workAssignments,
      futurePaths,
      sundayBrackets,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
