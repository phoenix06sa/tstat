import { NextResponse } from 'next/server';
import { aes } from '@/lib/aes';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Lightweight event metadata lookup — used to backfill real tournament
// names for saved tournaments without loading full tournament data.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const event = searchParams.get('event');
  const division = searchParams.get('division');

  if (!event) {
    return NextResponse.json({ error: 'Missing required param: event' }, { status: 400 });
  }

  const info = await aes(`/api/event/${event}`, 300);
  if (!info) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const divisionName = division
    ? (info.Divisions || []).find((d: { DivisionId: number }) => String(d.DivisionId) === division)?.Name || ''
    : '';

  return NextResponse.json({ name: info.Name || '', division: divisionName });
}
