'use client';

import { useEffect, useState, useCallback } from 'react';

interface SetScore { us: number | null; them: number | null }
interface PoolMatch {
  matchName: string; time: string; date: string; court: string;
  opponent: string; opponentCode: string; workTeam: string;
  hasScores: boolean; sets: SetScore[]; weWon: boolean | null; isPoolPlay: boolean;
}
interface WorkAssignment { play: string; time: string; date: string; court: string }
interface FuturePath {
  finishText: string; rank: number; isUs?: boolean; teamAtRank?: string;
  nextPlay: string; nextPlayShort: string;
  court: string; time: string;
  workCourt: string | null; workTime: string | null;
  saturdayEvening: boolean;
  note?: string;
  opponentResolved?: string;
  opponentPoolLabel?: string;
  finishRange?: string;
}
interface SundayBracket {
  name: string; shortName: string; courts: string[];
  teams: { teamName: string; teamCode: string; isUs: boolean; finishRank: number | null }[];
  hasTeams: boolean; weAreIn: boolean;
}
interface Standing {
  teamName: string; teamCode: string; isUs: boolean;
  matchesWon: number; matchesLost: number;
  setsWon: number; setsLost: number;
  matchPct: string; finishRank: number | null; overallRank: number | null;
  finishRankText: string; tiebreaker: string | null;
}
interface TournamentData {
  team: string; teamCode: string; teamId: string; event: string;
  venue: string; dates: string; division: string;
  fetchedAt: string; poolName: string; poolCourt: string;
  poolStandings: Standing[];
  poolMatches: PoolMatch[];
  workAssignments: WorkAssignment[];
  futurePaths: FuturePath[];
  sundayBrackets: SundayBracket[];
}
interface TeamOption {
  teamId: string; teamName: string; teamCode: string; club: string; pool: string;
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function SetScores({ sets, hasScores }: { sets: SetScore[]; hasScores: boolean }) {
  if (!hasScores) return <span className="text-zinc-500 text-sm">No scores yet</span>;
  const played = sets.filter(s => s.us !== null && s.them !== null);
  if (!played.length) return <span className="text-zinc-500 text-sm">No scores yet</span>;
  return (
    <div className="flex gap-2 mt-1">
      {played.map((s, i) => {
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

const DEFAULT_TEAM = 'g14askyl2ls';

export default function Home() {
  const [data, setData] = useState<TournamentData | null>(null);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [selectedTeam, setSelectedTeam] = useState(DEFAULT_TEAM);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState('');

  // Load team list once
  useEffect(() => {
    fetch('/api/teams').then(r => r.json()).then(d => setTeams(d.teams || []));
  }, []);

  const fetchData = useCallback(async (teamCode: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/tournament?team=${teamCode}&t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
      setLastRefresh(new Date().toISOString());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(selectedTeam); }, [fetchData, selectedTeam]);

  // Auto-refresh every 90 seconds
  useEffect(() => {
    const interval = setInterval(() => fetchData(selectedTeam), 90_000);
    return () => clearInterval(interval);
  }, [fetchData, selectedTeam]);

  function handleTeamChange(code: string) {
    setSelectedTeam(code);
    setData(null);
  }

  // Group teams by pool for the dropdown
  const poolGroups: Record<string, TeamOption[]> = {};
  for (const t of teams) {
    if (!poolGroups[t.pool]) poolGroups[t.pool] = [];
    poolGroups[t.pool].push(t);
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* Header */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-xs text-zinc-500 uppercase tracking-widest mb-0.5">Lone Star Regionals 2026</div>
              <div className="font-bold text-white text-lg leading-tight truncate">
                {data?.team || 'Loading…'}
              </div>
              <div className="text-zinc-500 text-xs">{data?.poolName}</div>
            </div>
            <button
              onClick={() => fetchData(selectedTeam)}
              disabled={loading}
              className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-sm px-3 py-2 rounded-lg flex items-center gap-2 transition-colors shrink-0"
            >
              <span className={loading ? 'animate-spin inline-block' : ''}>↻</span>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {/* Team selector */}
          <div className="relative">
            <select
              value={selectedTeam}
              onChange={e => handleTeamChange(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm rounded-lg px-3 py-2 pr-8 appearance-none focus:outline-none focus:border-yellow-500"
            >
              {Object.entries(poolGroups).map(([pool, poolTeams]) => (
                <optgroup key={pool} label={pool}>
                  {poolTeams.map(t => (
                    <option key={t.teamCode} value={t.teamCode}>
                      {t.teamName} ({t.teamCode})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 text-xs">▼</div>
          </div>
        </div>

        {lastRefresh && (
          <div className="max-w-2xl mx-auto mt-1 text-xs text-zinc-600">
            Updated {timeAgo(lastRefresh)} · auto-refreshes every 90s
          </div>
        )}
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {error && (
          <div className="bg-red-950 border border-red-800 rounded-xl p-4 text-red-300 text-sm">{error}</div>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center py-20 text-zinc-500">
            Loading tournament data…
          </div>
        )}

        {data && (
          <>
            {/* Event info */}
            <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
              <div className="text-xs text-zinc-500 uppercase tracking-widest mb-2">Event</div>
              <div className="font-semibold text-white">{data.event}</div>
              <div className="text-zinc-400 text-sm mt-1">{data.venue}</div>
              <div className="text-zinc-400 text-sm">{data.dates} &middot; {data.division} Division</div>
            </div>

            {/* Pool standings */}
            {data.poolStandings.length > 0 && (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-800">
                  <div className="text-xs text-zinc-500 uppercase tracking-widest">Pool Standings</div>
                  <div className="font-semibold text-white mt-0.5">{data.poolName}</div>
                  <div className="text-zinc-500 text-xs">{data.poolCourt}</div>
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
                    {data.poolStandings.map((s, i) => (
                      <tr key={i} className={`border-b border-zinc-800 last:border-0 ${s.isUs ? 'bg-yellow-950/40' : ''}`}>
                        <td className="px-4 py-3">
                          <div className={`font-medium ${s.isUs ? 'text-yellow-300' : 'text-zinc-200'}`}>
                            {s.isUs ? '★ ' : ''}{s.teamName}
                          </div>
                          <div className="text-zinc-600 text-xs">{s.teamCode}</div>
                          {s.tiebreaker && s.finishRank !== null && (
                            <div className={`text-xs mt-0.5 ${s.isUs ? 'text-yellow-600' : 'text-zinc-600'}`}>
                              ↑ {s.tiebreaker}
                            </div>
                          )}
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
            )}

            {/* Pool matches + bracket matches */}
            <div>
              {data.poolMatches.some(m => !m.isPoolPlay) && (
                <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3 px-1">Pool Matches</div>
              )}
              {!data.poolMatches.some(m => !m.isPoolPlay) && (
                <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3 px-1">Pool Matches</div>
              )}
              <div className="space-y-3">
                {data.poolMatches.filter(m => m.isPoolPlay).map((m, i) => (
                  <div key={i} className={`bg-zinc-900 rounded-xl border p-4 ${
                    m.weWon === true ? 'border-emerald-800' :
                    m.weWon === false ? 'border-red-900' : 'border-zinc-800'
                  }`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs text-zinc-500 font-mono">{m.matchName}</span>
                          <span className="text-xs text-zinc-600">{m.date} {m.time}</span>
                          <span className="text-xs text-zinc-600">{m.court}</span>
                        </div>
                        <div className="font-semibold text-white text-base">vs {m.opponent}</div>
                        <div className="text-zinc-600 text-xs mb-2">{m.opponentCode}</div>
                        <SetScores sets={m.sets} hasScores={m.hasScores} />
                      </div>
                      {m.weWon !== null && (
                        <div className={`text-xs font-bold px-2 py-1 rounded shrink-0 ${m.weWon ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>
                          {m.weWon ? 'WIN' : 'LOSS'}
                        </div>
                      )}
                    </div>
                    <div className="mt-2 text-xs text-zinc-600 border-t border-zinc-800 pt-2">Work team: {m.workTeam}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Bracket matches */}
            {data.poolMatches.some(m => !m.isPoolPlay) && (
              <div>
                <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3 px-1">Bracket Matches</div>
                <div className="space-y-3">
                  {data.poolMatches.filter(m => !m.isPoolPlay).map((m, i) => (
                    <div key={i} className={`bg-zinc-900 rounded-xl border p-4 ${
                      m.weWon === true ? 'border-emerald-800' :
                      m.weWon === false ? 'border-red-900' : 'border-blue-800'
                    }`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-xs text-blue-400 font-semibold">BRACKET</span>
                            <span className="text-xs text-zinc-500 font-mono">{m.matchName}</span>
                            <span className="text-xs text-zinc-600">{m.date} {m.time}</span>
                            <span className="text-xs text-zinc-600">{m.court}</span>
                          </div>
                          <div className="font-semibold text-white text-base">vs {m.opponent}</div>
                          <div className="text-zinc-600 text-xs mb-2">{m.opponentCode}</div>
                          <SetScores sets={m.sets} hasScores={m.hasScores} />
                        </div>
                        {m.weWon !== null ? (
                          <div className={`text-xs font-bold px-2 py-1 rounded shrink-0 ${m.weWon ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>
                            {m.weWon ? 'WIN' : 'LOSS'}
                          </div>
                        ) : (
                          <div className="text-xs font-bold px-2 py-1 rounded shrink-0 bg-blue-900 text-blue-300">LIVE</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {data.workAssignments.length > 0 && (
              <div>
                <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3 px-1">Work / Ref Assignments</div>
                <div className="space-y-2">
                  {data.workAssignments.map((w, i) => (
                    <div key={i} className="bg-zinc-900 rounded-xl border border-zinc-800 px-4 py-3 flex items-center gap-4">
                      <div className="text-zinc-400 font-mono text-sm font-semibold w-28">{w.date} {w.time}</div>
                      <div>
                        <div className="text-zinc-300 text-sm">{w.play}</div>
                        <div className="text-zinc-600 text-xs">{w.court}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bracket paths */}
            {data.futurePaths.length > 0 && (
              <div>
                <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3 px-1">Bracket Paths</div>
                <div className="space-y-3">
                  {data.futurePaths.map((f, i) => (
                    <div key={i} className={`bg-zinc-900 rounded-xl border p-4 ${f.isUs ? 'border-yellow-700' : f.saturdayEvening ? 'border-zinc-800' : 'border-zinc-700'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="text-xs text-zinc-500 mb-1">
                            If pool finishes <span className="text-yellow-400 font-semibold">{f.finishText}</span>
                            {f.teamAtRank && (
                              <span className={`ml-2 font-semibold ${f.isUs ? 'text-yellow-300' : 'text-zinc-400'}`}>
                                — {f.isUs ? '★ ' : ''}{f.teamAtRank}
                              </span>
                            )}
                          </div>
                          <div className="font-semibold text-white">{f.nextPlayShort}</div>
                          <div className="text-zinc-400 text-sm">{f.nextPlay}</div>
                          {f.finishRange && (
                            <div className={`mt-1 bg-zinc-800 rounded-lg px-3 py-2 text-xs ${f.saturdayEvening ? 'space-y-0.5' : ''}`}>
                              {f.saturdayEvening ? f.finishRange.split('\n').map((line, li) => (
                                <div key={li} className={li === 0 ? 'text-emerald-400' : 'text-zinc-400'}>{line}</div>
                              )) : (
                                <div className="text-zinc-400">{f.finishRange}</div>
                              )}
                            </div>
                          )}
                          {f.opponentResolved && (
                            <div className="mt-2 text-sm">
                              <span className="text-zinc-500 text-xs block">Opponent</span>
                              <span className="text-zinc-300">{f.opponentResolved}</span>
                              <div className="text-zinc-600 text-xs mt-0.5">{f.opponentPoolLabel}</div>
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-4 text-sm">
                            <div>
                              <span className="text-zinc-500 text-xs block">Match</span>
                              <span className="text-zinc-300">{f.court} @ {f.time}</span>
                            </div>
                            {f.workCourt && (
                              <div>
                                <span className="text-zinc-500 text-xs block">Work after</span>
                                <span className="text-zinc-300">{f.workCourt} @ {f.workTime}</span>
                              </div>
                            )}
                          </div>
                          {!f.saturdayEvening && f.note && (
                            <div className="mt-2 text-xs text-zinc-600 italic">{f.note}</div>
                          )}
                        </div>
                        <div className={`text-xs px-2 py-1 rounded shrink-0 font-semibold ${f.saturdayEvening ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-800 text-zinc-500'}`}>
                          {f.saturdayEvening ? 'Sat Eve' : 'Sun Only'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sunday brackets */}
            <div>
              <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3 px-1">Sunday May 10 — Final Brackets</div>
              {(() => {
                const ourBracket = data.sundayBrackets.find(b => b.weAreIn);
                const populatedBrackets = data.sundayBrackets.filter(b => b.hasTeams);
                if (ourBracket) {
                  return (
                    <div className="space-y-3">
                      <div className="bg-zinc-900 rounded-xl border border-yellow-700 p-4">
                        <div className="text-xs text-yellow-500 uppercase tracking-widest mb-1">Our Bracket</div>
                        <div className="font-bold text-white text-lg">{ourBracket.shortName}</div>
                        <div className="text-zinc-400 text-sm mb-2">{ourBracket.name}</div>
                        <div className="text-zinc-500 text-xs mb-2">Courts: {ourBracket.courts.join(', ')}</div>
                        <div className="space-y-1">
                          {ourBracket.teams.map((t, i) => (
                            <div key={i} className={`text-sm px-2 py-1 rounded ${t.isUs ? 'bg-yellow-950 text-yellow-300 font-semibold' : 'text-zinc-400'}`}>
                              {t.isUs ? '★ ' : ''}{t.teamName}
                              {t.finishRank && <span className="text-zinc-500 text-xs ml-1">(seeded #{t.finishRank})</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                      {populatedBrackets.filter(b => !b.weAreIn).map((b, i) => (
                        <div key={i} className="bg-zinc-900 rounded-xl border border-zinc-800 p-3">
                          <div className="font-medium text-zinc-300 text-sm">{b.shortName}</div>
                          <div className="text-zinc-600 text-xs">{b.courts.join(', ')}</div>
                          <div className="mt-1 space-y-0.5">
                            {b.teams.map((t, j) => (
                              <div key={j} className="text-zinc-500 text-xs">{t.teamName}</div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                }
                if (populatedBrackets.length > 0) {
                  return (
                    <div className="space-y-2">
                      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 text-zinc-400 text-sm">
                        Sunday brackets are being seeded. Our placement depends on Saturday evening results.
                      </div>
                      {populatedBrackets.map((b, i) => (
                        <div key={i} className="bg-zinc-900 rounded-xl border border-zinc-800 p-3">
                          <div className="font-medium text-zinc-300 text-sm">{b.shortName}</div>
                          <div className="text-zinc-600 text-xs">{b.courts.join(', ')}</div>
                          <div className="mt-1 space-y-0.5">
                            {b.teams.map((t, j) => (
                              <div key={j} className="text-zinc-500 text-xs">{t.teamName}</div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                }
                return (
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                    <div className="text-zinc-400 text-sm">
                      Sunday placement depends on Saturday pool finish and evening bracket results.
                      Available brackets: Gold, Silver A-D, Bronze A-D, Flight 1A-1D.
                    </div>
                    <div className="mt-3 space-y-1">
                      {data.sundayBrackets.map((b, i) => (
                        <div key={i} className="text-xs text-zinc-600 font-mono">{b.name}</div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Footer */}
            <div className="text-center text-zinc-700 text-xs pb-4">
              Data from AES · {data.teamCode} · {data.division}<br />
              Auto-refreshes every 90 seconds
            </div>
          </>
        )}
      </div>
    </div>
  );
}
