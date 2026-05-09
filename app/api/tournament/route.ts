import { NextResponse } from 'next/server';

const BASE = 'https://results.advancedeventsystems.com';
const EVENT = 'PTAwMDAwNDEyNDA90';
const DIV = '195174';
const TEAM_ID = '84723';
const TEAM_CODE = 'g14askyl2ls';
const TEAM_NAME = 'Austin Skyline 14 Black';

const AES_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'origin': 'https://results.advancedeventsystems.com',
  'referer': 'https://results.advancedeventsystems.com/',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

async function aes(path: string) {
  const res = await fetch(`${BASE}${path}`, { headers: AES_HEADERS, next: { revalidate: 60 } });
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

    // --- Future paths ---
    const futurePaths: object[] = [];
    if (future) {
      for (const f of future) {
        futurePaths.push({
          finishText: f.PotentialRankText,
          rank: f.PotentialRank,
          nextPlay: f.NextPlay?.CompleteFullName,
          nextPlayShort: f.NextPlay?.FullName,
          court: f.NextMatch?.Court?.Name,
          time: fmtTime(f.NextMatch?.ScheduledStartDateTime),
          workCourt: f.WorkMatch?.Court?.Name,
          workTime: fmtTime(f.WorkMatch?.ScheduledStartDateTime),
        });
      }
    }

    // --- Pool standings (find our pool from day1) ---
    let poolStandings: object[] = [];
    let poolName = '';
    let poolCourt = '';
    if (day1) {
      for (const play of day1) {
        const teams: { TeamCode: string; TeamName: string; MatchesWon: number; MatchesLost: number; SetsWon: number; SetsLost: number; MatchPercent: string; FinishRank: number | null; OverallRank: number | null }[] = play.Teams || [];
        const found = teams.find((t) => t.TeamCode?.toLowerCase() === TEAM_CODE.toLowerCase());
        if (found) {
          poolName = play.CompleteFullName || play.FullName;
          poolCourt = play.Courts?.[0]?.Name || '';
          poolStandings = teams.map((t) => ({
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
          break;
        }
      }
    }

    // --- Sunday bracket info ---
    const sundayBrackets: string[] = [];
    if (day2) {
      for (const play of day2) {
        sundayBrackets.push(play.CompleteFullName || play.FullName);
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
