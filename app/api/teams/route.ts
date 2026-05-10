import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BASE = 'https://results.advancedeventsystems.com';
const EVENT = 'PTAwMDAwNDEyNDA90';
const DIV = '195174';

const AES_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'origin': 'https://results.advancedeventsystems.com',
  'referer': 'https://results.advancedeventsystems.com/',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

export async function GET() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await fetch(`${BASE}/api/event/${EVENT}/division/${DIV}/plays/2026-05-09`, { headers: AES_HEADERS, next: { revalidate: 300 } } as any);
  const day1 = await res.json();

  const pools = day1.filter((p: { PlayType: number }) => p.PlayType === 0)
    .sort((a: { Order: number }, b: { Order: number }) => a.Order - b.Order);

  const teams = [];
  for (const pool of pools) {
    for (const t of (pool.Teams || [])) {
      teams.push({
        teamId: String(t.TeamId),
        teamName: t.TeamName,
        teamCode: t.TeamCode,
        club: t.Club?.Name || '',
        pool: pool.FullName,
        poolOrder: pool.Order,
      });
    }
  }

  return NextResponse.json({ teams, event: '2026 Lone Star Regionals (12-14s)', division: '14 Bid' });
}
