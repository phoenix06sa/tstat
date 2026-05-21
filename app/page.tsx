'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

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
  bracketDate?: string;
  workCourt: string | null; workTime: string | null;
  note?: string;
  opponentResolved?: string;
  finishRange?: string;
}
interface ActiveBracketMatch {
  matchId: number; matchName: string; time: string; court: string;
  team1: string; team2: string; team1code: string; team2code: string;
  resolvedTeam1: string; resolvedTeam2: string;
  hasUs: boolean; hasScores: boolean;
  team1Won: boolean; team2Won: boolean;
  weWon: boolean | null;
  sets: SetScore[]; depth: number; isWinnersSide: boolean;
}
interface ActiveBracketRound {
  label: string; isChampPath: boolean; matches: ActiveBracketMatch[];
}
interface ActiveBracket {
  bracketName: string; completeName: string; courts: string[];
  winnersRounds: ActiveBracketRound[];
  placementMatches: ActiveBracketMatch[];
  totalMatches: number;
  finishRange: { best: string; worst: string; note: string } | null;
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
  matches: PoolMatch[];
  workAssignments: WorkAssignment[];
  futurePaths: FuturePath[];
  activeBracket: ActiveBracket | null;
  finalStandings: { overallRank: number; tied: boolean; teamName: string; bracket: string; bracketRank: number; isUs: boolean }[];
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

export default function Home() {
  const router = useRouter();
  const [data, setData] = useState<TournamentData | null>(null);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState('');
  const [config, setConfig] = useState<{ eventId: string; divisionId: string; eventName: string } | null>(null);

  // Check for configuration and load default team
  useEffect(() => {
    const eventId = localStorage.getItem('tracker_eventId');
    const divisionId = localStorage.getItem('tracker_divisionId');
    const eventName = localStorage.getItem('tracker_eventName');
    const defaultTeam = localStorage.getItem('tracker_defaultTeam');

    if (!eventId || !divisionId) {
      router.push('/setup');
      return;
    }

    setConfig({ eventId, divisionId, eventName: eventName || 'Tournament' });
    if (defaultTeam) setSelectedTeam(defaultTeam);
    else {
      // No team selected, go to setup to select one
      router.push('/setup');
    }
  }, [router]);

  // Load team list once after config is loaded
  useEffect(() => {
    if (!config) return;
    fetch(`/api/teams?event=${config.eventId}&division=${config.divisionId}&eventName=${encodeURIComponent(config.eventName)}`)
      .then(r => r.json())
      .then(d => setTeams(d.teams || []));
  }, [config]);

  const fetchData = useCallback(async (teamCode: string) => {
    if (!config) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/tournament?team=${teamCode}&event=${config.eventId}&division=${config.divisionId}&t=${Date.now()}`);
      if (!res.ok) {
        const errorText = await res.text();
        try {
          const json = JSON.parse(errorText);
          if (json.error) throw new Error(json.error);
        } catch {
          // If not JSON, use the text
        }
        throw new Error(`HTTP ${res.status}: ${errorText || 'Unknown error'}`);
      }
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
      setLastRefresh(new Date().toISOString());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => { if (selectedTeam && config) fetchData(selectedTeam); }, [fetchData, selectedTeam, config]);

  // Auto-refresh every 90 seconds
  useEffect(() => {
    if (!selectedTeam || !config) return;
    const interval = setInterval(() => fetchData(selectedTeam), 90_000);
    return () => clearInterval(interval);
  }, [fetchData, selectedTeam, config]);

  function handleTeamChange(code: string) {
    setSelectedTeam(code);
    localStorage.setItem('tracker_defaultTeam', code);
    setData(null);
  }

  function handleReconfigure() {
    router.push('/setup');
  }

  // Group teams by pool for the dropdown
  const poolGroups: Record<string, TeamOption[]> = {};
  for (const t of teams) {
    if (!poolGroups[t.pool]) poolGroups[t.pool] = [];
    poolGroups[t.pool].push(t);
  }

  const renderMatch = (m: ActiveBracketMatch, key: number, teamCode: string) => {
    const displayTeam1 = m.resolvedTeam1 || m.team1;
    const displayTeam2 = m.resolvedTeam2 || m.team2;
    const isPending1 = !m.hasScores && displayTeam1.startsWith('Winner of');
    const isPending2 = !m.hasScores && displayTeam2.startsWith('Winner of');
    const borderColor = m.hasUs
      ? m.hasScores
        ? m.weWon ? 'border-emerald-700' : 'border-red-800'
        : 'border-yellow-700'
      : m.isWinnersSide ? 'border-zinc-800' : 'border-zinc-700/50';
    const winnerTeam = m.hasScores ? (m.team1Won ? displayTeam1 : displayTeam2) : null;
    return (
      <div key={key} className={`bg-zinc-900 rounded-xl border px-4 py-3 ${borderColor}`}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-xs text-zinc-600">{m.matchName}</span>
          <span className="text-xs text-zinc-600">{m.time} {m.court}</span>
        </div>
        <div className={`flex items-center justify-between py-1 ${m.team1code.toLowerCase() === teamCode ? 'text-yellow-300' : m.hasScores && !m.team1Won ? 'text-zinc-600' : isPending1 ? 'text-zinc-600 italic' : 'text-zinc-200'}`}>
          <span className="text-sm font-medium">
            {m.team1code.toLowerCase() === teamCode ? '★ ' : ''}{displayTeam1}
          </span>
          {m.hasScores && m.team1Won && <span className="text-xs bg-emerald-900 text-emerald-300 px-2 py-0.5 rounded font-bold">WIN</span>}
        </div>
        <div className="border-t border-zinc-800 my-1" />
        <div className={`flex items-center justify-between py-1 ${m.team2code.toLowerCase() === teamCode ? 'text-yellow-300' : m.hasScores && !m.team2Won ? 'text-zinc-600' : isPending2 ? 'text-zinc-600 italic' : 'text-zinc-200'}`}>
          <span className="text-sm font-medium">
            {m.team2code.toLowerCase() === teamCode ? '★ ' : ''}{displayTeam2}
          </span>
          {m.hasScores && m.team2Won && <span className="text-xs bg-emerald-900 text-emerald-300 px-2 py-0.5 rounded font-bold">WIN</span>}
        </div>
        {m.hasScores && m.sets.length > 0 && (
          <div className="flex gap-2 mt-2 pt-2 border-t border-zinc-800">
            {m.sets.map((s, si) => (
              <span key={si} className="text-xs font-mono text-zinc-500">
                {s.us !== null ? `${s.us}-${s.them}` : `${(s as unknown as {s1:number}).s1}-${(s as unknown as {s2:number}).s2}`}
              </span>
            ))}
            {winnerTeam && <span className="text-xs text-zinc-600 ml-auto">→ {winnerTeam}</span>}
          </div>
        )}
        {!m.hasScores && m.hasUs && (
          <div className="mt-1 text-xs text-yellow-600">↑ Our match</div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* Header */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto">
          {/* Event info */}
          {data && (
            <div className="mb-3">
              <div className="font-semibold text-white text-base">{data.event}</div>
              <div className="text-zinc-400 text-sm">{data.venue}</div>
              <div className="text-zinc-400 text-sm">{data.dates} · {data.division} Division</div>
            </div>
          )}

          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-bold text-white text-lg leading-tight truncate">
                {data?.team || 'Loading…'}
              </div>
              <div className="text-zinc-500 text-xs">{data?.poolName}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleReconfigure}
                className="bg-zinc-800 hover:bg-zinc-700 text-sm px-3 py-2 rounded-lg transition-colors shrink-0"
                title="Configure event"
              >
                ⚙
              </button>
              <button
                onClick={() => fetchData(selectedTeam)}
                disabled={loading}
                className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-sm px-3 py-2 rounded-lg flex items-center gap-2 transition-colors shrink-0"
              >
                <span className={loading ? 'animate-spin inline-block' : ''}>↻</span>
                {loading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
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

            {/* Bracket Paths — where each pool finish rank leads */}
            {data.futurePaths.length > 0 && (
              <div>
                <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3 px-1">Bracket Paths</div>
                <div className="space-y-3">
                  {data.futurePaths.map((f, i) => {
                    const borderColor = f.isUs ? 'border-yellow-700' : 'border-zinc-800';
                    return (
                      <div key={i} className={`bg-zinc-900 rounded-xl border p-4 ${borderColor}`}>
                        <div className="flex-1">
                          {/* Header: rank + team */}
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-xs font-mono text-yellow-500 font-semibold">{f.finishText}</span>
                            {f.teamAtRank && (
                              <span className={`text-sm font-semibold ${f.isUs ? 'text-yellow-300' : 'text-zinc-300'}`}>
                                {f.isUs ? '★ ' : ''}{f.teamAtRank}
                              </span>
                            )}
                          </div>

                          {/* Bracket destination + time */}
                          <div className="font-semibold text-white">{f.nextPlayShort}</div>
                          {f.bracketDate && (
                            <div className="text-zinc-500 text-xs">{f.bracketDate}</div>
                          )}
                          {(f.court || f.time) && (
                            <div className="text-zinc-500 text-xs">{[f.court, f.time].filter(Boolean).join(' · ')}</div>
                          )}

                          {/* Opponent */}
                          {f.opponentResolved && (
                            <div className="mt-1.5 text-sm">
                              <span className="text-zinc-500 text-xs">vs </span>
                              <span className="text-zinc-200">{f.opponentResolved}</span>
                            </div>
                          )}

                          {/* Finish range / destination */}
                          {f.finishRange && (
                            <div className="mt-2 bg-zinc-800 rounded-lg px-3 py-2 text-xs space-y-0.5">
                              {f.finishRange.split('\n').map((line: string, li: number) => (
                                <div key={li} className={li === 0 ? 'text-emerald-400' : 'text-zinc-400'}>{line}</div>
                              ))}
                            </div>
                          )}

                          {/* Work */}
                          {f.workCourt && f.workTime && (
                            <div className="mt-1.5 text-xs text-zinc-600">Work: {f.workCourt} @ {f.workTime}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* All matches grouped by day */}
            <div>
              <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3 px-1">Matches</div>
              {(() => {
                const matchesByDate: Record<string, PoolMatch[]> = {};
                for (const m of data.matches) {
                  const d = m.date || 'Unknown';
                  if (!matchesByDate[d]) matchesByDate[d] = [];
                  matchesByDate[d].push(m);
                }
                return Object.entries(matchesByDate).map(([date, dayMatches]) => (
                  <div key={date} className="mb-6">
                    <div className="text-xs text-zinc-400 uppercase tracking-wider mb-2 px-1 font-semibold">{date}</div>
                    <div className="space-y-3">
                      {dayMatches.map((m, i) => (
                        <div key={i} className={`bg-zinc-900 rounded-xl border p-4 ${
                          m.weWon === true ? 'border-emerald-800' :
                          m.weWon === false ? 'border-red-900' : 'border-zinc-800'
                        }`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-xs text-zinc-500 font-mono">{m.matchName}</span>
                                <span className="text-xs text-zinc-600">{m.time}</span>
                                <span className="text-xs text-zinc-600">{m.court}</span>
                                {m.isPoolPlay && <span className="text-xs bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded">Pool</span>}
                                {!m.isPoolPlay && <span className="text-xs bg-purple-900/50 text-purple-300 px-1.5 py-0.5 rounded">Bracket</span>}
                              </div>
                              <div className="font-semibold text-white text-base">vs {m.opponent}</div>
                              <SetScores sets={m.sets} hasScores={m.hasScores} />
                            </div>
                            {m.weWon !== null && (
                              <div className={`text-xs font-bold px-2 py-1 rounded shrink-0 ${m.weWon ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>
                                {m.weWon ? 'WIN' : 'LOSS'}
                              </div>
                            )}
                          </div>
                          {m.workTeam && <div className="mt-2 text-xs text-zinc-600 border-t border-zinc-800 pt-2">Work: {m.workTeam}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>

            {/* Work assignments */}
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

            {/* Active Bracket — round-by-round view */}
            {data.activeBracket && (
              <div>
                <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3 px-1">
                  Bracket Play — {data.activeBracket.bracketName}
                </div>
                <div className="space-y-4">
                  {/* Header card */}
                  <div className="bg-zinc-900 rounded-xl border border-yellow-700 px-4 py-3">
                    <div className="font-bold text-white">{data.activeBracket.bracketName}</div>
                    <div className="text-zinc-500 text-xs">{data.activeBracket.completeName}</div>
                    {data.activeBracket.finishRange && (
                      <div className="mt-1 text-xs">
                        <span className="text-zinc-500">Finish range: </span>
                        <span className="text-emerald-400">{data.activeBracket.finishRange.best}</span>
                        <span className="text-zinc-500"> – </span>
                        <span className="text-zinc-400">{data.activeBracket.finishRange.worst}</span>
                        <span className="text-zinc-500"> of 64</span>
                      </div>
                    )}
                  </div>

                  {/* Championship path — Round of 16 → Quarters → Semis → Championship */}
                  {data.activeBracket.winnersRounds.map((round, ri) => (
                    <div key={ri}>
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <div className={`h-px flex-1 ${ri === data.activeBracket!.winnersRounds.length - 1 ? 'bg-yellow-700' : 'bg-emerald-900'}`} />
                        <span className={`text-xs font-bold uppercase tracking-widest ${ri === data.activeBracket!.winnersRounds.length - 1 ? 'text-yellow-500' : 'text-emerald-700'}`}>
                          {ri === data.activeBracket!.winnersRounds.length - 1 ? '🏆 ' : ''}{round.label}
                        </span>
                        <div className={`h-px flex-1 ${ri === data.activeBracket!.winnersRounds.length - 1 ? 'bg-yellow-700' : 'bg-emerald-900'}`} />
                      </div>
                      <div className="space-y-2 mb-4">
                        {round.matches.map((m, mi) => renderMatch(m, mi, data.teamCode))}
                      </div>
                    </div>
                  ))}

                  {/* Placement matches — shown collapsed at the bottom */}
                  {data.activeBracket.placementMatches.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <div className="h-px flex-1 bg-zinc-800" />
                        <span className="text-xs text-zinc-600 font-semibold uppercase tracking-widest">Placement Matches (3rd–16th)</span>
                        <div className="h-px flex-1 bg-zinc-800" />
                      </div>
                      <div className="space-y-2">
                        {data.activeBracket.placementMatches.map((m, mi) => renderMatch(m, mi, data.teamCode))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Final Standings — full 64-team list after all bracket play complete */}
            {data.finalStandings && data.finalStandings.length > 0 && (
              <div>
                <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3 px-1">Final Standings</div>
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-zinc-500 text-xs border-b border-zinc-800">
                        <th className="text-center px-3 py-2 w-10">Rank</th>
                        <th className="text-left px-3 py-2">Team</th>
                        <th className="text-right px-3 py-2 hidden sm:table-cell text-zinc-600">Bracket</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.finalStandings.map((s, i) => (
                        <tr key={i} className={`border-b border-zinc-800 last:border-0 ${s.isUs ? 'bg-yellow-950/40' : ''}`}>
                          <td className="text-center px-3 py-2.5">
                            <span className={`text-xs font-bold font-mono ${
                              s.overallRank === 1 ? 'text-yellow-400' :
                              s.overallRank <= 3 ? 'text-zinc-300' :
                              s.isUs ? 'text-yellow-500' :
                              'text-zinc-500'
                            }`}>
                              {s.tied ? 'T-' : ''}{s.overallRank}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`font-medium ${s.isUs ? 'text-yellow-300' : 'text-zinc-200'}`}>
                              {s.isUs ? '★ ' : ''}{s.teamName}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right hidden sm:table-cell">
                            <span className="text-zinc-600 text-xs">{s.bracket}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="text-center text-zinc-700 text-xs pb-4 space-y-2">
              <div>{data.teamCode} · {data.division} · Auto-refreshes every 90s</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
