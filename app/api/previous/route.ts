import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BASE = 'https://results.advancedeventsystems.com';
const PREV_EVENT = 'PTAwMDAwNDIwNDA90';
const PREV_DIV = '207190';
const TEAM_ID = '84723';
const TEAM_CODE = 'g14askyl2ls';
const TEAM_NAME = 'Austin Skyline 14 Black';

const AES_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'origin': 'https://results.advancedeventsystems.com',
  'referer': 'https://results.advancedeventsystems.com/',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function aes(path: string): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await fetch(`${BASE}${path}`, { headers: AES_HEADERS, next: { revalidate: 3600 } } as any);
  if (!res.ok || res.status === 204) return null;
  const text = await res.text();
  if (!text || text.trim() === '') return null;
  try { return JSON.parse(text); } catch { return null; }
}

function fmtTime(iso: string) {
  if (!iso) return '';
  const [datePart, time] = iso.split('T');
  const [h, m] = time.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const d = new Date(datePart + 'T12:00:00');
  const dayName = days[d.getDay()];
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${dayName} ${month}/${day} ${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export async function GET() {
  try {
    const [past, day1, day2, day3, eventInfo] = await Promise.all([
      aes(`/api/event/${PREV_EVENT}/division/${PREV_DIV}/team/${TEAM_ID}/schedule/past`),
      aes(`/api/event/${PREV_EVENT}/division/${PREV_DIV}/plays/2026-05-01`),
      aes(`/api/event/${PREV_EVENT}/division/${PREV_DIV}/plays/2026-05-02`),
      aes(`/api/event/${PREV_EVENT}/division/${PREV_DIV}/plays/2026-05-03`),
      aes(`/api/event/${PREV_EVENT}`),
    ]);

    // --- Build match history from past ---
    const matches: object[] = [];
    if (past) {
      for (const block of past) {
        const m = block.Match;
        if (!m) continue;
        const iFirst = m.FirstTeamId === Number(TEAM_ID);
        const opponent = iFirst ? m.SecondTeamName : m.FirstTeamName;
        const ourWon = iFirst ? m.FirstTeamWon : m.SecondTeamWon;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sets = (m.Sets || []).map((s: any) => ({
          us: iFirst ? s.FirstTeamScore : s.SecondTeamScore,
          them: iFirst ? s.SecondTeamScore : s.FirstTeamScore,
        })).filter((s: { us: number | null }) => s.us !== null);
        const playType = block.Play?.Type ?? 0;
        const playName = block.Play?.FullName ?? '';
        matches.push({
          time: fmtTime(m.ScheduledStartDateTime),
          playName,
          playType,
          isPool: playType === 0,
          opponent,
          weWon: ourWon,
          sets,
          court: m.Court?.Name || '',
        });
      }
    }

    // --- Pool standings per day ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getPoolStandings = (dayPlays: any) => {
      if (!dayPlays) return null;
      const pools = dayPlays.filter((p: { PlayType: number }) => p.PlayType === 0);
      for (const pool of pools) {
        const teams = pool.Teams || [];
        const found = teams.find((t: { TeamCode: string }) => t.TeamCode?.toLowerCase() === TEAM_CODE);
        if (found) {
          return {
            poolName: pool.CompleteFullName || pool.FullName,
            court: pool.Courts?.[0]?.Name || '',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            teams: teams.map((t: any) => ({
              teamName: t.TeamName,
              teamCode: t.TeamCode,
              isUs: t.TeamCode?.toLowerCase() === TEAM_CODE,
              matchesWon: t.MatchesWon,
              matchesLost: t.MatchesLost,
              setsWon: t.SetsWon,
              setsLost: t.SetsLost,
              finishRank: t.FinishRank,
              finishRankText: t.FinishRankText,
            })),
          };
        }
      }
      return null;
    };

    const day1Pool = getPoolStandings(day1);
    const day2Pool = getPoolStandings(day2);

    // Day 3 Teams arrays are empty in past tournaments (AES clears them)
    // We know from the past matches: last match was Gold Bracket, they lost
    // So they finished in Gold bracket (top 16 of 62 teams)
    const finalBracket = 'Gold Bracket';
    const finalRank = null; // exact rank within Gold not available from past data
    const finalRankText = 'Top 16';

    return NextResponse.json({
      team: TEAM_NAME,
      teamCode: TEAM_CODE,
      event: eventInfo?.Name || '2026 Salt Lake City Showdown W2',
      venue: eventInfo?.Location || 'Salt Palace Convention Center',
      dates: 'May 1-3, 2026',
      division: '14 Liberty (14L)',
      totalTeams: 62,
      matches,
      day1Pool,
      day2Pool,
      finalBracket,
      finalRank,
      finalRankText,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
