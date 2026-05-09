'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface SetScore { us: number | null; them: number | null }
interface Match {
  time: string; playName: string; playType: number; isPool: boolean;
  opponent: string; weWon: boolean; sets: SetScore[]; court: string;
}
interface Standing {
  teamName: string; teamCode: string; isUs: boolean;
  matchesWon: number; matchesLost: number;
  setsWon: number; setsLost: number;
  finishRank: number | null; finishRankText: string;
}
interface PoolStandings {
  poolName: string; court: string; teams: Standing[];
}
interface PreviousData {
  team: string; teamCode: string; event: string;
  venue: string; dates: string; division: string; totalTeams: number;
  matches: Match[];
  day1Pool: PoolStandings | null;
  day2Pool: PoolStandings | null;
  finalBracket: string;
  finalRank: number | null;
  finalRankText: string;
}

function SetScores({ sets }: { sets: SetScore[] }) {
  if (!sets.length) return null;
  return (
    <div className="flex gap-2 mt-1">
      {sets.map((s, i) => {
        const weWon = (s.us ?? 0) > (s.them ?? 0);
        return (
          <span key={i} className={`text-sm font-mono px-2 py-0.5 rounded ${weWon ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>
            {s.us}-{s.them}
          </span>
        );
      })}
    </div>
  );
}

function PoolTable({ pool, label }: { pool: PoolStandings; label: string }) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800">
        <div className="text-xs text-zinc-500 uppercase tracking-widest">{label}</div>
        <div className="font-semibold text-white mt-0.5">{pool.poolName}</div>
        <div className="text-zinc-500 text-xs">{pool.court}</div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-zinc-500 text-xs border-b border-zinc-800">
            <th className="text-left px-4 py-2">Team</th>
            <th className="text-center px-2 py-2">M W-L</th>
            <th className="text-center px-2 py-2">S W-L</th>
            <th className="text-center px-2 py-2">Rank</th>
          </tr>
        </thead>
        <tbody>
          {pool.teams.map((s, i) => (
            <tr key={i} className={`border-b border-zinc-800 last:border-0 ${s.isUs ? 'bg-yellow-950/40' : ''}`}>
              <td className="px-4 py-3">
                <div className={`font-medium ${s.isUs ? 'text-yellow-300' : 'text-zinc-200'}`}>
                  {s.isUs ? '★ ' : ''}{s.teamName}
                </div>
                <div className="text-zinc-600 text-xs">{s.teamCode}</div>
              </td>
              <td className="text-center px-2 py-3 text-zinc-300">{s.matchesWon}-{s.matchesLost}</td>
              <td className="text-center px-2 py-3 text-zinc-300">{s.setsWon}-{s.setsLost}</td>
              <td className="text-center px-2 py-3">
                {s.finishRank ? (
                  <span className={`rounded px-2 py-0.5 text-xs font-bold ${s.isUs ? 'bg-yellow-800 text-yellow-200' : 'bg-zinc-700 text-zinc-200'}`}>
                    {s.finishRankText || `#${s.finishRank}`}
                  </span>
                ) : <span className="text-zinc-600 text-xs">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PreviousPage() {
  const [data, setData] = useState<PreviousData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/previous')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  // Group matches by day
  const day1Matches = data?.matches.filter(m => m.time.includes('5/1')) || [];
  const day2Matches = data?.matches.filter(m => m.time.includes('5/2')) || [];
  const day3Matches = data?.matches.filter(m => m.time.includes('5/3')) || [];

  const totalWins = data?.matches.filter(m => m.weWon).length ?? 0;
  const totalLosses = data?.matches.filter(m => !m.weWon).length ?? 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* Header */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <div className="text-xs text-zinc-500 uppercase tracking-widest mb-0.5">Previous Tournament</div>
            <div className="font-bold text-white text-lg leading-tight">Austin Skyline 14 Black</div>
          </div>
          <Link href="/" className="bg-zinc-800 hover:bg-zinc-700 text-sm px-3 py-2 rounded-lg transition-colors text-zinc-300">
            ← Live Tracker
          </Link>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {error && <div className="bg-red-950 border border-red-800 rounded-xl p-4 text-red-300 text-sm">{error}</div>}
        {loading && <div className="flex items-center justify-center py-20 text-zinc-500">Loading results…</div>}

        {data && (
          <>
            {/* Event info */}
            <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
              <div className="text-xs text-zinc-500 uppercase tracking-widest mb-2">Event</div>
              <div className="font-semibold text-white">{data.event}</div>
              <div className="text-zinc-400 text-sm mt-1">{data.venue}</div>
              <div className="text-zinc-400 text-sm">{data.dates} · {data.division} · {data.totalTeams} teams</div>
            </div>

            {/* Final result banner */}
            {data.finalBracket && (
              <div className={`rounded-xl p-4 border ${data.finalRank && data.finalRank <= 4 ? 'bg-yellow-950/40 border-yellow-700' : 'bg-zinc-900 border-zinc-700'}`}>
                <div className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Final Result</div>
                <div className="font-bold text-white text-2xl">{data.finalRankText} place</div>
                <div className="text-zinc-400 text-sm mt-1">{data.finalBracket} · {totalWins}W–{totalLosses}L overall</div>
              </div>
            )}

            {/* Day 1 */}
            <div>
              <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3 px-1">Thursday May 1 — Pool Play + Cross Bracket</div>
              {data.day1Pool && <PoolTable pool={data.day1Pool} label="Day 1 Pool Standings" />}
              <div className="space-y-3 mt-3">
                {day1Matches.map((m, i) => (
                  <div key={i} className={`bg-zinc-900 rounded-xl border p-4 ${m.weWon ? 'border-emerald-800' : 'border-red-900'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {!m.isPool && <span className="text-xs text-blue-400 font-semibold">BRACKET</span>}
                          <span className="text-xs text-zinc-500 font-mono">{m.playName}</span>
                          <span className="text-xs text-zinc-600">{m.time}</span>
                          {m.court && <span className="text-xs text-zinc-600">{m.court}</span>}
                        </div>
                        <div className="font-semibold text-white">vs {m.opponent}</div>
                        <SetScores sets={m.sets} />
                      </div>
                      <div className={`text-xs font-bold px-2 py-1 rounded shrink-0 ${m.weWon ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>
                        {m.weWon ? 'WIN' : 'LOSS'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Day 2 */}
            <div>
              <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3 px-1">Friday May 2 — Pool Play</div>
              {data.day2Pool && <PoolTable pool={data.day2Pool} label="Day 2 Pool Standings" />}
              <div className="space-y-3 mt-3">
                {day2Matches.map((m, i) => (
                  <div key={i} className={`bg-zinc-900 rounded-xl border p-4 ${m.weWon ? 'border-emerald-800' : 'border-red-900'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs text-zinc-500 font-mono">{m.playName}</span>
                          <span className="text-xs text-zinc-600">{m.time}</span>
                          {m.court && <span className="text-xs text-zinc-600">{m.court}</span>}
                        </div>
                        <div className="font-semibold text-white">vs {m.opponent}</div>
                        <SetScores sets={m.sets} />
                      </div>
                      <div className={`text-xs font-bold px-2 py-1 rounded shrink-0 ${m.weWon ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>
                        {m.weWon ? 'WIN' : 'LOSS'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Day 3 */}
            <div>
              <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3 px-1">Saturday May 3 — Final Brackets</div>
              <div className="space-y-3">
                {day3Matches.map((m, i) => (
                  <div key={i} className={`bg-zinc-900 rounded-xl border p-4 ${m.weWon ? 'border-emerald-800' : 'border-red-900'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs text-blue-400 font-semibold">BRACKET</span>
                          <span className="text-xs text-zinc-500 font-mono">{m.playName}</span>
                          <span className="text-xs text-zinc-600">{m.time}</span>
                          {m.court && <span className="text-xs text-zinc-600">{m.court}</span>}
                        </div>
                        <div className="font-semibold text-white">vs {m.opponent}</div>
                        <SetScores sets={m.sets} />
                      </div>
                      <div className={`text-xs font-bold px-2 py-1 rounded shrink-0 ${m.weWon ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>
                        {m.weWon ? 'WIN' : 'LOSS'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="text-center text-zinc-700 text-xs pb-4">
              <Link href="/" className="text-zinc-600 hover:text-zinc-400 underline transition-colors">
                ← Back to Live Tracker
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
