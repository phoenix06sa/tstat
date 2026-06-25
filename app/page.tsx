'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface SetScore { us: number | null; them: number | null }
interface PoolMatch {
  matchName: string; time: string; date: string; court: string;
  opponent: string; opponentCode: string; workTeam: string;
  hasScores: boolean; sets: SetScore[]; weWon: boolean | null; isPoolPlay: boolean;
}
interface WorkAssignment { play: string; time: string; date: string; court: string }
interface BracketRoundMatch { matchName: string; team1: string; team2: string; court: string; time: string; isPlacement: boolean; hasUs: boolean }
interface BracketRound { label: string; matches: BracketRoundMatch[] }
interface FuturePath {
  finishText: string; rank: number; isUs?: boolean; teamAtRank?: string;
  nextPlay: string; nextPlayShort: string;
  court: string; time: string;
  bracketDate?: string;
  workCourt: string | null; workTime: string | null;
  note?: string;
  opponentResolved?: string;
  finishRange?: string;
  seed?: number | null;
  bracketRounds?: BracketRound[];
  bracketTeamCount?: number;
  nextType?: 'pool' | 'bracket' | null;
  nextOpponents?: string[];
}
interface ChainedBracket {
  bracketName: string; via: string; bracketDate: string; time: string;
  bracketRounds: BracketRound[]; bracketTeamCount: number; finishRange: string;
}
interface BracketCard {
  bracketName: string; finishRange: string; bracketDate: string; time: string;
  teamCount: number; bracketRounds: BracketRound[];
  relation: 'direct' | 'chained' | 'other'; detail: string; sortKey: number;
  confirmed: boolean;
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
  startTime: string;
  populated: boolean;
  finishRange: { best: string; worst: string; note: string } | null;
}
interface Standing {
  teamName: string; teamCode: string; isUs: boolean;
  matchesWon: number; matchesLost: number;
  setsWon: number; setsLost: number;
  matchPct: string; finishRank: number | null; overallRank: number | null;
  finishRankText: string; tiebreaker: string | null;
}
interface PoolInfo {
  poolName: string; poolCourt: string; date: string; standings: Standing[];
}
interface TournamentData {
  team: string; teamCode: string; teamId: string; event: string;
  venue: string; dates: string; division: string;
  fetchedAt: string; poolName: string; poolCourt: string;
  poolStandings: Standing[];
  pools: PoolInfo[];
  matches: PoolMatch[];
  workAssignments: WorkAssignment[];
  futurePaths: FuturePath[];
  chainedPaths: ChainedBracket[];
  bracketCards: BracketCard[];
  activeBracket: ActiveBracket | null;
  activeBrackets: Record<string, ActiveBracket>;
  finalStandings: { overallRank: number; tied: boolean; teamName: string; bracket: string; bracketRank: number; isUs: boolean }[];
  totalTeams: number;
  eventComplete: boolean;
  buildId?: string;
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

const WEEKDAYS: Record<string, string> = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
const MONTHS: Record<string, string> = { Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June', Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December' };

// Split a formatted date like "Tue, Jun 16" into a prominent weekday label
// ("Tuesday") and a full date ("June 16, 2026"). Year comes from the event's
// date range since the per-day strings don't carry it.
function splitDateLabel(formatted: string, year: string): { weekday: string; full: string } {
  if (!formatted) return { weekday: '', full: '' };
  const [wd, rest = ''] = formatted.split(', ');
  const weekday = WEEKDAYS[wd] || '';
  const m = rest.match(/^([A-Za-z]+)\s+(\d+)$/);
  const full = m ? `${MONTHS[m[1]] || m[1]} ${m[2]}${year ? `, ${year}` : ''}` : rest;
  return { weekday, full };
}

function SetScores({ sets, hasScores, eventComplete }: { sets: SetScore[]; hasScores: boolean; eventComplete?: boolean }) {
  const emptyLabel = eventComplete ? 'No result recorded' : 'No scores yet';
  if (!hasScores) return <span className="text-zinc-400 text-sm">{emptyLabel}</span>;
  const played = sets.filter(s => s.us !== null && s.them !== null);
  if (!played.length) return <span className="text-zinc-400 text-sm">{emptyLabel}</span>;
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

interface SavedTournament {
  eventId: string;
  divisionId: string;
  eventName: string;
  teamCode: string;
  teamName?: string;
  addedAt: number;
}

// Hub is the landing screen; the others are the features it links to.
type View = 'hub' | 'tracker' | 'work' | 'standings' | 'pools' | 'seeds' | 'courts';

// Division-wide data (team-agnostic) from /api/division
interface DivisionPoolStanding {
  teamName: string; teamCode: string;
  matchesWon: number; matchesLost: number; setsWon: number; setsLost: number;
  finishRank: number | null; finishRankText: string;
}
interface DivisionPool {
  name: string; courts: string[]; date: string; order: number;
  complete: boolean; standings: DivisionPoolStanding[];
}
interface DivisionSeed { seed: number; teamName: string; teamCode: string; club: string }
interface DivisionCourt {
  name: string;
  entries: { poolName: string; date: string; complete: boolean; teams: { teamName: string; teamCode: string }[] }[];
}
interface DivisionData {
  event: string; poolPlayComplete: boolean;
  pools: DivisionPool[]; seeds: DivisionSeed[]; courts: DivisionCourt[];
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-400">Loading…</div>}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<TournamentData | null>(null);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState('');
  const [config, setConfig] = useState<{ eventId: string; divisionId: string; eventName: string } | null>(null);
  const [savedTournaments, setSavedTournaments] = useState<SavedTournament[]>([]);
  const [showTournamentSwitcher, setShowTournamentSwitcher] = useState(false);
  const [copied, setCopied] = useState(false);
  // True only once we've confirmed a valid setup to show. Until then (or while
  // redirecting an un-setup visitor to /setup) we render a neutral splash
  // instead of flashing the half-loaded tracker.
  const [ready, setReady] = useState(false);
  // Which screen of the app is showing: the hub or one feature.
  const [view, setView] = useState<View>('hub');
  // Division-wide data for the pools/seeds/courts views (lazy-loaded)
  const [divisionData, setDivisionData] = useState<DivisionData | null>(null);
  const [divisionLoading, setDivisionLoading] = useState(false);
  const [selectedCourt, setSelectedCourt] = useState<string | null>(null);

  // Load saved tournaments list from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('tracker_savedTournaments');
      if (saved) setSavedTournaments(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  // Backfill real tournament names for saved entries still showing
  // missing or placeholder names
  useEffect(() => {
    const stale = savedTournaments.filter(s => !s.eventName || s.eventName === 'Tournament');
    if (stale.length === 0) return;
    let cancelled = false;
    (async () => {
      const updated = [...savedTournaments];
      let changed = false;
      for (const s of stale) {
        try {
          const res = await fetch(`/api/event-info?event=${s.eventId}`);
          if (!res.ok) continue;
          const json = await res.json();
          if (json.name) {
            const entry = updated.find(u => u.eventId === s.eventId && u.divisionId === s.divisionId && u.teamCode === s.teamCode);
            if (entry) { entry.eventName = json.name; changed = true; }
          }
        } catch { /* ignore */ }
      }
      if (!cancelled && changed) {
        localStorage.setItem('tracker_savedTournaments', JSON.stringify(updated));
        setSavedTournaments(updated);
      }
    })();
    return () => { cancelled = true; };
  }, [savedTournaments]);

  // Check for configuration: URL params → localStorage → redirect to setup
  useEffect(() => {
    // Priority 1: URL params (?event=X&division=Y&team=Z)
    const urlEvent = searchParams.get('event');
    const urlDivision = searchParams.get('division');
    const urlTeam = searchParams.get('team');

    if (urlEvent && urlDivision && urlTeam) {
      // Save to localStorage for future visits
      localStorage.setItem('tracker_eventId', urlEvent);
      localStorage.setItem('tracker_divisionId', urlDivision);
      localStorage.setItem('tracker_defaultTeam', urlTeam);
      // Add to saved tournaments list if not already there
      const saved: SavedTournament[] = JSON.parse(localStorage.getItem('tracker_savedTournaments') || '[]');
      const exists = saved.some(s => s.eventId === urlEvent && s.divisionId === urlDivision && s.teamCode === urlTeam);
      if (!exists) {
        saved.push({ eventId: urlEvent, divisionId: urlDivision, eventName: '', teamCode: urlTeam, addedAt: Date.now() });
        localStorage.setItem('tracker_savedTournaments', JSON.stringify(saved));
        setSavedTournaments(saved);
      }
      setConfig({ eventId: urlEvent, divisionId: urlDivision, eventName: '' });
      setSelectedTeam(urlTeam);
      setReady(true);
      return;
    }

    // Priority 2: localStorage
    const eventId = localStorage.getItem('tracker_eventId');
    const divisionId = localStorage.getItem('tracker_divisionId');
    const eventName = localStorage.getItem('tracker_eventName');
    const defaultTeam = localStorage.getItem('tracker_defaultTeam');

    if (!eventId || !divisionId) {
      router.push('/setup');
      return;
    }

    setConfig({ eventId, divisionId, eventName: eventName || 'Tournament' });
    if (defaultTeam) {
      setSelectedTeam(defaultTeam);
      setReady(true);
    } else {
      router.push('/setup');
    }
  }, [router, searchParams]);

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
        let message = `HTTP ${res.status}: ${errorText || 'Unknown error'}`;
        try {
          const json = JSON.parse(errorText);
          if (json.error) message = json.error;
        } catch {
          // Not JSON — keep the raw text message
        }
        throw new Error(message);
      }
      const json = await res.json();
      if (json.error) throw new Error(json.error);

      // Auto-update: this API is polled every 90s, so use it to notice when a
      // newer deploy is live. The running client was built with one BUILD_ID
      // (baked into its bundle); the server returns the *current* deploy's id.
      // If they differ, a cached shell is stale — reload to pull fresh code.
      // A home-screen "refresh" only re-fetches data, never the shell, so this
      // is what actually gets new code onto bookmarked/installed copies.
      // sessionStorage guards against a reload loop if the shell stays cached.
      const runningBuild = process.env.NEXT_PUBLIC_BUILD_ID;
      const liveBuild: string | undefined = json.buildId;
      if (runningBuild && liveBuild && runningBuild !== liveBuild &&
          sessionStorage.getItem('reloadedForBuild') !== liveBuild) {
        sessionStorage.setItem('reloadedForBuild', liveBuild);
        window.location.reload();
        return;
      }

      setData(json);
      setLastRefresh(new Date().toISOString());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => { if (selectedTeam && config) fetchData(selectedTeam); }, [fetchData, selectedTeam, config]);

  // Division-wide data (everyone's pools, seeds, courts) — independent of the
  // selected team, so it's fetched lazily the first time a division view opens.
  const fetchDivision = useCallback(async () => {
    if (!config) return;
    setDivisionLoading(true);
    try {
      const res = await fetch(`/api/division?event=${config.eventId}&division=${config.divisionId}&t=${Date.now()}`);
      const json = await res.json();
      if (!json.error) setDivisionData(json);
    } catch { /* ignore */ } finally {
      setDivisionLoading(false);
    }
  }, [config]);

  const onDivisionView = view === 'pools' || view === 'seeds' || view === 'courts';
  // Load once when a division view first opens…
  useEffect(() => {
    if (onDivisionView && config && !divisionData && !divisionLoading) fetchDivision();
  }, [onDivisionView, config, divisionData, divisionLoading, fetchDivision]);
  // …and keep it fresh on a 90s tick while one is open.
  useEffect(() => {
    if (!onDivisionView || !config) return;
    const id = setInterval(() => fetchDivision(), 90_000);
    return () => clearInterval(id);
  }, [onDivisionView, config, fetchDivision]);
  // Court drill-down is per-visit; reset it when leaving the courts view.
  useEffect(() => { if (view !== 'courts') setSelectedCourt(null); }, [view]);

  // Auto-refresh every 90 seconds
  useEffect(() => {
    if (!selectedTeam || !config) return;
    const interval = setInterval(() => fetchData(selectedTeam), 90_000);
    return () => clearInterval(interval);
  }, [fetchData, selectedTeam, config]);

  // Update saved tournament metadata once data loads
  useEffect(() => {
    if (!data || !config) return;
    const eventName = data.event || '';
    if (eventName && config.eventName !== eventName) {
      setConfig(prev => prev ? { ...prev, eventName } : prev);
      localStorage.setItem('tracker_eventName', eventName);
    }
    // Update saved tournaments list with real names
    const saved: SavedTournament[] = JSON.parse(localStorage.getItem('tracker_savedTournaments') || '[]');
    let changed = false;
    for (const s of saved) {
      if (s.eventId === config.eventId && s.divisionId === config.divisionId && s.teamCode === selectedTeam) {
        // Replace missing or placeholder names with the real ones from the API
        if (eventName && s.eventName !== eventName) { s.eventName = eventName; changed = true; }
        if (data.team && s.teamName !== data.team) { s.teamName = data.team; changed = true; }
      }
    }
    if (changed) {
      localStorage.setItem('tracker_savedTournaments', JSON.stringify(saved));
      setSavedTournaments(saved);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  function handleTeamChange(code: string) {
    setSelectedTeam(code);
    localStorage.setItem('tracker_defaultTeam', code);
    setData(null);
  }

  function handleReconfigure() {
    router.push('/setup');
  }

  // Open a feature from the hub. Push a history entry so the device/browser
  // back button (and the in-app "Home" button) returns to the hub naturally.
  function openView(v: View) {
    setView(v);
    window.history.pushState({ trackerView: v }, '');
  }
  function backToHub() {
    // Pop the pushed entry; the popstate handler restores the hub view.
    window.history.back();
  }

  // Keep the view in sync with browser history so back/forward works.
  useEffect(() => {
    const onPop = () => {
      const s = window.history.state as { trackerView?: View } | null;
      setView(s?.trackerView ?? 'hub');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function switchTournament(t: SavedTournament) {
    localStorage.setItem('tracker_eventId', t.eventId);
    localStorage.setItem('tracker_divisionId', t.divisionId);
    localStorage.setItem('tracker_eventName', t.eventName || '');
    localStorage.setItem('tracker_defaultTeam', t.teamCode);
    setConfig({ eventId: t.eventId, divisionId: t.divisionId, eventName: t.eventName || '' });
    setSelectedTeam(t.teamCode);
    setData(null);
    setDivisionData(null); // division-wide data is event/division specific
    setShowTournamentSwitcher(false);
  }

  function removeTournament(t: SavedTournament) {
    const updated = savedTournaments.filter(s => !(s.eventId === t.eventId && s.divisionId === t.divisionId && s.teamCode === t.teamCode));
    localStorage.setItem('tracker_savedTournaments', JSON.stringify(updated));
    setSavedTournaments(updated);
  }

  function getShareUrl(): string {
    if (!config || !selectedTeam) return '';
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    return `${base}/?event=${config.eventId}&division=${config.divisionId}&team=${selectedTeam}`;
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
      : m.isWinnersSide ? 'border-zinc-700' : 'border-zinc-700/50';
    const winnerTeam = m.hasScores ? (m.team1Won ? displayTeam1 : displayTeam2) : null;
    return (
      <div key={key} className={`bg-zinc-900 rounded-xl border px-4 py-3 ${borderColor}`}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-xs text-zinc-500">{m.matchName}</span>
          <span className="text-xs text-zinc-500">{m.time} {m.court}</span>
        </div>
        <div className={`flex items-center justify-between py-1 ${m.team1code.toLowerCase() === teamCode ? 'text-yellow-300' : m.hasScores && !m.team1Won ? 'text-zinc-500' : isPending1 ? 'text-zinc-500 italic' : 'text-zinc-200'}`}>
          <span className="text-sm font-medium">
            {displayTeam1}
          </span>
          {m.hasScores && m.team1Won && <span className="text-xs bg-emerald-900 text-emerald-300 px-2 py-0.5 rounded font-bold">WIN</span>}
          {m.hasScores && !m.team1Won && m.team1code.toLowerCase() === teamCode && <span className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded font-bold">LOST</span>}
        </div>
        <div className="border-t border-zinc-700 my-1" />
        <div className={`flex items-center justify-between py-1 ${m.team2code.toLowerCase() === teamCode ? 'text-yellow-300' : m.hasScores && !m.team2Won ? 'text-zinc-500' : isPending2 ? 'text-zinc-500 italic' : 'text-zinc-200'}`}>
          <span className="text-sm font-medium">
            {displayTeam2}
          </span>
          {m.hasScores && m.team2Won && <span className="text-xs bg-emerald-900 text-emerald-300 px-2 py-0.5 rounded font-bold">WIN</span>}
          {m.hasScores && !m.team2Won && m.team2code.toLowerCase() === teamCode && <span className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded font-bold">LOST</span>}
        </div>
        {m.hasScores && m.sets.length > 0 && (
          <div className="flex gap-2 mt-2 pt-2 border-t border-zinc-700">
            {m.sets.map((s, si) => (
              <span key={si} className="text-xs font-mono text-zinc-400">
                {s.us !== null ? `${s.us}-${s.them}` : `${(s as unknown as {s1:number}).s1}-${(s as unknown as {s2:number}).s2}`}
              </span>
            ))}
            {winnerTeam && <span className="text-xs text-zinc-500 ml-auto">→ {winnerTeam}</span>}
          </div>
        )}
        {!m.hasScores && m.hasUs && (
          <div className="mt-1 text-xs text-yellow-600">↑ Our match</div>
        )}
      </div>
    );
  };

  // Until we've confirmed a saved tournament, show a neutral splash. Visitors
  // with no setup are redirected to /setup without ever seeing the tracker.
  if (!ready) {
    return <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-400">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* Header */}
      <div className="bg-zinc-900 border-b border-zinc-700 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto">
          {/* Event info */}
          {data && (
            <div className="mb-3">
              <div className="font-semibold text-white text-base">{data.event}</div>
              <div className="text-zinc-400 text-sm">{data.venue}</div>
              <div className="text-zinc-400 text-sm">{data.dates} · {data.division} Division</div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex-1 min-w-0">
              <div className="font-bold text-white text-lg leading-tight truncate">
                {data?.team || 'Loading…'}
              </div>
              <div className="text-zinc-400 text-xs truncate">{data?.poolName}</div>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                onClick={async () => {
                  const url = getShareUrl();
                  if (!url) return;
                  try {
                    await navigator.clipboard.writeText(url);
                  } catch {
                    // Fallback: prompt user with the URL
                    window.prompt('Copy this share link:', url);
                  }
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className={`text-sm px-2.5 sm:px-3 py-2 rounded-lg transition-colors shrink-0 ${copied ? 'bg-emerald-800 text-emerald-200' : 'bg-zinc-800 hover:bg-zinc-700'}`}
                title="Copy share link"
              >
                {copied ? '✓' : '🔗'}
              </button>
              {savedTournaments.length > 1 && (
                <button
                  onClick={() => setShowTournamentSwitcher(!showTournamentSwitcher)}
                  className="bg-zinc-800 hover:bg-zinc-700 text-sm px-2.5 sm:px-3 py-2 rounded-lg transition-colors shrink-0"
                  title="Switch tournament"
                >
                  📋
                </button>
              )}
              <button
                onClick={handleReconfigure}
                className="bg-zinc-800 hover:bg-zinc-700 text-sm px-2.5 sm:px-3 py-2 rounded-lg transition-colors shrink-0"
                title="Configure event"
              >
                ⚙
              </button>
              <button
                onClick={() => fetchData(selectedTeam)}
                disabled={loading}
                className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-sm px-2.5 sm:px-3 py-2 rounded-lg flex items-center gap-2 transition-colors shrink-0"
                title="Refresh"
              >
                <span className={loading ? 'animate-spin inline-block' : ''}>↻</span>
                <span className="hidden sm:inline">{loading ? 'Loading…' : 'Refresh'}</span>
              </button>
            </div>
          </div>

          {/* Tournament switcher panel */}
          {showTournamentSwitcher && (
            <div className="mb-3 bg-zinc-800 border border-zinc-700 rounded-xl p-3 space-y-2">
              <div className="text-xs text-zinc-400 font-semibold uppercase tracking-wider mb-2">Saved Tournaments</div>
              {savedTournaments.map((t, i) => {
                const isCurrent = t.eventId === config?.eventId && t.divisionId === config?.divisionId && t.teamCode === selectedTeam;
                return (
                  <div key={i} className={`flex items-center justify-between p-2 rounded-lg ${isCurrent ? 'bg-yellow-900/30 border border-yellow-800/50' : 'bg-zinc-900 hover:bg-zinc-700'}`}>
                    <button
                      onClick={() => !isCurrent && switchTournament(t)}
                      className="flex-1 text-left"
                      disabled={isCurrent}
                    >
                      <div className={`text-sm font-medium ${isCurrent ? 'text-yellow-300' : 'text-zinc-200'}`}>
                        {t.eventName || `Event ${t.eventId.slice(0, 8)}…`}
                      </div>
                      <div className="text-xs text-zinc-400">
                        {t.teamName || t.teamCode}
                      </div>
                    </button>
                    {!isCurrent && (
                      <button onClick={() => removeTournament(t)} className="text-zinc-500 hover:text-red-400 text-xs ml-2 px-2">✕</button>
                    )}
                  </div>
                );
              })}
              <button
                onClick={handleReconfigure}
                className="w-full text-center text-xs text-zinc-400 hover:text-zinc-200 py-2 border border-dashed border-zinc-700 rounded-lg"
              >
                + Add tournament
              </button>
            </div>
          )}

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
          <div className="max-w-2xl mx-auto mt-1 text-xs text-zinc-500">
            Updated {timeAgo(lastRefresh)} · auto-refreshes every 90s
          </div>
        )}
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {error && (
          <div className="bg-red-950 border border-red-800 rounded-xl p-4 text-red-300 text-sm">{error}</div>
        )}

        {/* Hub — four boxes that lead to each feature */}
        {view === 'hub' && (() => {
          const upcomingWork = data?.workAssignments.length || 0;
          const tiles: { target: View | null; emoji: string; title: string; desc: string; badge?: string; beta?: boolean }[] = [
            { target: 'tracker', emoji: '🏐', title: 'Live Tracker', desc: 'Your team: matches & bracket path' },
            { target: 'pools', emoji: '🏟️', title: 'Division Pool Play', desc: 'Everyone’s pools & standings' },
            { target: 'courts', emoji: '📍', title: 'Court Play', desc: 'Find teams by floor', beta: true },
            { target: 'work', emoji: '🧹', title: 'Work Schedule', desc: 'When & where your team reffs', badge: upcomingWork ? `${upcomingWork} upcoming` : undefined },
            { target: 'seeds', emoji: '🔢', title: 'Starting Seeds', desc: 'Pre-tournament overall ranking' },
            { target: 'standings', emoji: '🏆', title: 'Final Standings', desc: data?.eventComplete ? 'Final results are in' : 'Posts at end of tournament' },
          ];
          return (
            <div className="grid grid-cols-2 gap-3">
              {tiles.map(t => (
                <button
                  key={t.title}
                  onClick={() => t.target && openView(t.target)}
                  disabled={!t.target}
                  className={`text-left bg-zinc-900 rounded-xl border border-zinc-700 p-4 min-h-32 flex flex-col transition-colors ${t.target ? 'hover:bg-zinc-800 hover:border-zinc-600' : 'opacity-50 cursor-default'}`}
                >
                  <div className="text-3xl mb-2">{t.emoji}</div>
                  <div className="flex items-center gap-1.5">
                    <div className="font-semibold text-white text-sm">{t.title}</div>
                    {t.beta && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-amber-300 bg-amber-900/40 border border-amber-700/50 rounded px-1 py-0.5 leading-none">Beta</span>
                    )}
                  </div>
                  <div className="text-zinc-400 text-xs mt-0.5 flex-1">{t.desc}</div>
                  {t.badge && (
                    <div className="mt-2 self-start inline-block text-[11px] font-semibold text-yellow-300 bg-yellow-900/40 border border-yellow-800/50 rounded px-1.5 py-0.5">
                      {t.badge}
                    </div>
                  )}
                </button>
              ))}
            </div>
          );
        })()}

        {/* Back to the hub from any feature view */}
        {view !== 'hub' && (
          <button
            onClick={backToHub}
            className="text-zinc-400 hover:text-zinc-200 text-sm flex items-center gap-1"
          >
            ← Home
          </button>
        )}

        {view !== 'hub' && loading && !data && (
          <div className="flex items-center justify-center py-20 text-zinc-400">
            Loading tournament data…
          </div>
        )}

        {view === 'tracker' && data && (
          <>
            {/* Each round: its pool standings, then that round's matches */}
            {(() => {
              const pools = data.pools && data.pools.length > 0
                ? data.pools
                : data.poolStandings.length > 0
                  ? [{ poolName: data.poolName, poolCourt: data.poolCourt, date: '', standings: data.poolStandings }]
                  : [];

              // Pool matches grouped by date (bracket matches live in Bracket Play)
              const matchesByDate: Record<string, PoolMatch[]> = {};
              for (const m of data.matches.filter(m => m.isPoolPlay)) {
                const d = m.date || 'Date TBA';
                if (!matchesByDate[d]) matchesByDate[d] = [];
                matchesByDate[d].push(m);
              }
              const usedDates = new Set<string>();
              const singlePool = pools.length <= 1;
              const year = (data.dates.match(/\b(20\d{2})\b/) || [])[1] || '';

              const matchCard = (m: PoolMatch, i: number) => (
                <div key={i} className={`bg-zinc-900 rounded-xl border p-4 ${
                  m.weWon === true ? 'border-emerald-800' :
                  m.weWon === false ? 'border-red-900' : 'border-zinc-700'
                }`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs text-zinc-400 font-mono">{m.matchName}</span>
                        <span className="text-xs text-zinc-500">{m.time}</span>
                        <span className="text-xs text-zinc-500">{m.court}</span>
                        {m.isPoolPlay && <span className="text-xs bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded">Pool</span>}
                        {!m.isPoolPlay && <span className="text-xs bg-purple-900/50 text-purple-300 px-1.5 py-0.5 rounded">Bracket</span>}
                      </div>
                      {(m.opponent || '').trim()
                        ? <div className="font-semibold text-white text-base">vs {m.opponent}</div>
                        : <div className="font-semibold text-zinc-400 italic text-base">Opponent TBD</div>}
                      <SetScores sets={m.sets} hasScores={m.hasScores} eventComplete={data.eventComplete} />
                    </div>
                    {m.weWon !== null && (
                      <div className={`text-xs font-bold px-2 py-1 rounded shrink-0 ${m.weWon ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>
                        {m.weWon ? 'WIN' : 'LOSS'}
                      </div>
                    )}
                  </div>
                  {m.workTeam && <div className="mt-2 text-xs text-zinc-500 border-t border-zinc-700 pt-2">Work: {m.workTeam}</div>}
                </div>
              );

              const standingsTable = (pool: PoolInfo, dl: { weekday: string; full: string }) => (
                <div className="bg-zinc-900 rounded-xl border border-zinc-700 overflow-x-auto">
                  <div className="px-4 py-3 border-b border-zinc-700">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="text-base font-bold text-white">{dl.weekday ? `${dl.weekday}: ` : ''}Pool Standings</div>
                      {dl.full && <div className="text-xs text-zinc-400 shrink-0">{dl.full}</div>}
                    </div>
                    <div className="text-zinc-300 text-sm mt-0.5">{pool.poolName}</div>
                    <div className="text-zinc-500 text-xs">{pool.poolCourt}</div>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-zinc-400 text-xs border-b border-zinc-700">
                        <th className="text-left px-4 py-2">Team</th>
                        <th className="text-center px-2 py-2">M W-L</th>
                        <th className="text-center px-2 py-2">S W-L</th>
                        <th className="text-center px-2 py-2">Rank</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pool.standings.map((s, i) => (
                        <tr key={i} className={`border-b border-zinc-700 last:border-0 ${s.isUs ? 'bg-yellow-950/40' : ''}`}>
                          <td className="px-4 py-3">
                            <div className={`font-medium ${s.isUs ? 'text-yellow-300' : 'text-zinc-200'}`}>
                              {s.teamName}
                            </div>
                            <div className="text-zinc-500 text-xs">{s.teamCode}</div>
                            {s.tiebreaker && s.finishRank !== null && (
                              <div className={`text-xs mt-0.5 ${s.isUs ? 'text-yellow-600' : 'text-zinc-500'}`}>
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
                            ) : <span className="text-zinc-500 text-xs">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );

              return (
                <>
                  {pools.map((pool, pi) => {
                    const dl = splitDateLabel(pool.date, year);
                    let roundMatches: PoolMatch[] = [];
                    if (pool.date && matchesByDate[pool.date]) {
                      roundMatches = matchesByDate[pool.date];
                      usedDates.add(pool.date);
                    } else if (singlePool) {
                      roundMatches = data.matches.filter(m => m.isPoolPlay);
                      Object.keys(matchesByDate).forEach(k => usedDates.add(k));
                    }
                    return (
                      <div key={pi} className="space-y-3">
                        {standingsTable(pool, dl)}
                        {roundMatches.length > 0 && (
                          <div className="space-y-3">
                            <div className="flex items-baseline justify-between gap-2 px-1">
                              <div className="text-base font-bold text-white">{dl.weekday ? `${dl.weekday}: ` : ''}Matches</div>
                              {dl.full && <div className="text-xs text-zinc-400 shrink-0">{dl.full}</div>}
                            </div>
                            {roundMatches.map(matchCard)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Safety net: any pool matches whose date didn't line up with a round */}
                  {Object.entries(matchesByDate).filter(([d]) => !usedDates.has(d)).map(([date, ms]) => {
                    const dl = splitDateLabel(date, year);
                    return (
                      <div key={date} className="space-y-3">
                        <div className="flex items-baseline justify-between gap-2 px-1">
                          <div className="text-base font-bold text-white">{dl.weekday ? `${dl.weekday}: ` : ''}Matches</div>
                          {(dl.full || date) && <div className="text-xs text-zinc-400 shrink-0">{dl.full || date}</div>}
                        </div>
                        {ms.map(matchCard)}
                      </div>
                    );
                  })}
                </>
              );
            })()}

            {/* Predicted Next Round — re-pool formats seed the next pool round
                from this one; show where each finish leads before brackets seed */}
            {(() => {
              const repool = data.futurePaths.filter(f => f.nextType === 'pool');
              if (repool.length === 0) return null;
              return (
                <div>
                  <div className="text-xs text-zinc-400 uppercase tracking-widest mb-1 px-1">Predicted Next Round</div>
                  <div className="text-xs text-zinc-500 mb-3 px-1">Where each pool finish leads · opponents resolve as pools complete</div>
                  <div className="space-y-3">
                    {repool.map((f) => (
                      <div key={f.rank} className="bg-zinc-900 rounded-xl border border-zinc-700 px-4 py-3">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-sm font-semibold text-yellow-300">{f.finishText}</span>
                          <span className="text-xs text-zinc-500">
                            {f.bracketDate || ''}{f.court ? ` · ${f.court}` : ''}
                          </span>
                        </div>
                        <div className="text-sm text-zinc-200">→ {f.nextPlay}</div>
                        {f.nextOpponents && f.nextOpponents.length > 0 && (
                          <div className="mt-1 text-xs text-zinc-400">
                            vs {f.nextOpponents.join(' · ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Challenge Rounds + Bracket Play. Challenge/crossover brackets are
                stepping stones that decide which division you land in (no final
                finish rank), so they get their own section above the divisions. */}
            {data.bracketCards.length > 0 && (() => {
                    // Our bracket always renders the live scored view; other
                    // brackets switch from the static who-plays-who tree to the
                    // scored view once their teams are slotted.
                    const viewFor = (bracketName: string) => {
                      const ourActive = data.activeBracket?.bracketName === bracketName ? data.activeBracket : null;
                      const otherView = !ourActive ? (data.activeBrackets?.[bracketName] || null) : null;
                      return ourActive || (otherView?.populated ? otherView : null);
                    };
                    const renderBody = (bracketName: string, rounds: BracketRound[], highlightUs: boolean) => {
                      const view = viewFor(bracketName);
                      if (view) {
                        return (
                          <div className="border-t border-zinc-700">
                            {view.winnersRounds.map((round, ri) => (
                              <div key={ri} className="border-b border-zinc-700/50 last:border-0">
                                <div className="px-4 py-2 bg-zinc-800/30">
                                  <span className={`text-xs font-bold uppercase tracking-wider ${ri === view.winnersRounds.length - 1 ? 'text-yellow-500' : 'text-emerald-600'}`}>
                                    {ri === view.winnersRounds.length - 1 ? '🏆 ' : ''}{round.label}
                                  </span>
                                </div>
                                <div className="px-4 py-2 space-y-2">
                                  {round.matches.map((m, mi) => renderMatch(m, mi, data.teamCode))}
                                </div>
                              </div>
                            ))}
                            {view.placementMatches.length > 0 && (
                              <div>
                                <div className="px-4 py-2 bg-zinc-800/30">
                                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Placement Matches</span>
                                </div>
                                <div className="px-4 py-2 space-y-2">
                                  {view.placementMatches.map((m, mi) => renderMatch(m, mi, data.teamCode))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      }
                      if (rounds.length > 0) {
                        return (
                          <div className="border-t border-zinc-700">
                            {rounds.map((round, ri) => (
                              <div key={ri} className="border-b border-zinc-700/50 last:border-0">
                                <div className="px-4 py-2 bg-zinc-800/30">
                                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{round.label}</span>
                                </div>
                                <div className="px-4 py-2 space-y-1.5">
                                  {round.matches.map((m: BracketRoundMatch, mi: number) => {
                                    // Only flag our slot when this bracket is still
                                    // a live landing spot. In brackets we've been
                                    // ruled out of, our pool ref shouldn't light up.
                                    const us = highlightUs && m.hasUs;
                                    return (
                                      <div key={mi} className={`flex items-center text-xs px-2 py-1.5 rounded ${us ? 'bg-yellow-950/40 border border-yellow-800/50' : 'bg-zinc-800/30'}`}>
                                        <span className={`flex-1 truncate ${us ? 'text-yellow-300 font-semibold' : 'text-zinc-300'}`}>{m.team1}</span>
                                        <span className="text-zinc-500 mx-2 shrink-0">vs</span>
                                        <span className={`flex-1 text-right truncate ${us ? 'text-yellow-300 font-semibold' : 'text-zinc-300'}`}>{m.team2}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      }
                      return null;
                    };

                    // Once any bracket is confirmed as our landing spot, we know
                    // where we're playing — so stop coloring the brackets we could
                    // have landed in but didn't. The bracket we're actually in
                    // (activeBracket) is ground truth even when the pool→bracket
                    // prediction never mapped our finish to it — multi-stage
                    // Challenge/Division formats land us somewhere via win/lose
                    // feeds, not a direct pool ref.
                    const activeName = data.activeBracket?.bracketName;
                    const placementKnown = !!activeName || data.bracketCards.some(c => c.confirmed);
                    const renderCard = (c: BracketCard) => {
                          const played = activeName === c.bracketName;
                          const confirmed = c.confirmed || played;
                          const onPath = c.relation !== 'other' || played;
                          // Color a bracket when it's on our path AND either we
                          // don't yet know our finish (so it's a live prediction)
                          // or it's our confirmed landing spot. Ruled-out brackets
                          // go back to gray.
                          const highlight = onPath && (!placementKnown || confirmed);
                          // Highlighted, but our finish isn't locked yet: we could
                          // land here, we don't know that we will.
                          const predicted = highlight && !confirmed;
                          const startTime = viewFor(c.bracketName)?.startTime || c.time;
                          // Show every bracket's tree (predicted who-plays-who now,
                          // live scored once teams are slotted) — on path or not
                          const rounds = c.bracketRounds;
                          return (
                            <div key={c.bracketName} className={`bg-zinc-900 rounded-xl border overflow-hidden ${highlight ? 'border-yellow-700' : 'border-zinc-700'}`}>
                              <div className="px-4 pt-4 pb-3">
                                {predicted && (
                                  <div className="mb-2">
                                    <span className="inline-flex items-center gap-1.5 rounded-md bg-yellow-900/40 border border-yellow-700/60 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-yellow-300">
                                      ◆ Prediction · you could land here
                                    </span>
                                    <div className="mt-1 text-xs text-yellow-600/90">
                                      Highlighted because a pool finish leads here. Matchups (e.g. “Winner of Match 1”) lock in as games finish.
                                    </div>
                                  </div>
                                )}
                                {highlight && confirmed && (
                                  <div className="mb-2">
                                    <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-900/40 border border-emerald-700/60 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                                      ★ Your bracket
                                    </span>
                                  </div>
                                )}
                                <div className="flex items-center justify-between mb-1 gap-2">
                                  <div className={`font-semibold text-base ${highlight ? 'text-white' : 'text-zinc-300'}`}>{c.bracketName}</div>
                                  {c.finishRange && (
                                    <div className={`text-xs font-semibold shrink-0 ${highlight ? 'text-emerald-400' : 'text-zinc-500'}`}>{c.finishRange}</div>
                                  )}
                                </div>
                                <div className="text-zinc-500 text-xs">
                                  {c.teamCount > 0 ? `${c.teamCount} teams` : ''}
                                  {c.bracketDate ? ` · ${c.bracketDate}` : ''}
                                  {startTime ? ` · starts ${startTime}` : ''}
                                </div>
                                {c.detail && (
                                  <div className="mt-2 text-xs text-zinc-300">{c.detail}</div>
                                )}
                              </div>
                              {renderBody(c.bracketName, rounds, highlight)}
                            </div>
                          );
                    };

                    // Challenge/crossover brackets carry no final finish range —
                    // they're stepping stones that decide which division you land
                    // in, so they go in their own section above the divisions.
                    const challengeCards = data.bracketCards.filter(c => !c.finishRange);
                    const divisionCards = data.bracketCards.filter(c => c.finishRange);
                    // Label the section after whatever the event names them:
                    // "Challenge 4" → "Challenge Rounds", "Crossover 1" → "Crossover Rounds".
                    const challengeWord = challengeCards[0]?.bracketName.match(/^([A-Za-z]+)/)?.[1] || 'Challenge';

                    return (
                      <>
                        {challengeCards.length > 0 && (
                          <div>
                            <div className="text-xs text-zinc-400 uppercase tracking-widest mb-1 px-1">{challengeWord} Rounds</div>
                            <div className="text-xs text-zinc-500 mb-3 px-1">Stepping-stone brackets · win or lose here to set which division you play</div>
                            <div className="space-y-4">
                              {challengeCards.map(renderCard)}
                            </div>
                          </div>
                        )}
                        {divisionCards.length > 0 && (
                          <div>
                            <div className="text-xs text-zinc-400 uppercase tracking-widest mb-1 px-1">Bracket Play</div>
                            <div className="text-xs text-zinc-500 mb-3 px-1">
                              {placementKnown
                                ? 'Your bracket highlighted · all divisions by finish'
                                : 'Predicted landing spots highlighted · all divisions by finish'}
                            </div>
                            <div className="space-y-4">
                              {divisionCards.map(renderCard)}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}

            {/* Fallback: scored bracket view when our bracket isn't among the Bracket Play cards */}
            {data.activeBracket && !data.bracketCards.some(c => c.bracketName === data.activeBracket!.bracketName) && (
              <div>
                <div className="text-xs text-zinc-400 uppercase tracking-widest mb-3 px-1">
                  Bracket Results — {data.activeBracket.bracketName}
                </div>
                <div className="space-y-4">
                  {/* Header card */}
                  <div className="bg-zinc-900 rounded-xl border border-yellow-700 px-4 py-3">
                    <div className="font-bold text-white">{data.activeBracket.bracketName}</div>
                    <div className="text-zinc-400 text-xs">{data.activeBracket.completeName}</div>
                    {data.activeBracket.finishRange && (
                      <div className="mt-1 text-xs">
                        <span className="text-zinc-400">Finish range: </span>
                        <span className="text-emerald-400">{data.activeBracket.finishRange.best}</span>
                        <span className="text-zinc-400"> – </span>
                        <span className="text-zinc-400">{data.activeBracket.finishRange.worst}</span>
                        {data.totalTeams > 0 && <span className="text-zinc-400"> of {data.totalTeams}</span>}
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
                        <span className="text-xs text-zinc-500 font-semibold uppercase tracking-widest">Placement Matches</span>
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

            {/* Footer */}
            <div className="text-center text-zinc-500 text-xs pb-4 space-y-2">
              <div>{data.teamCode} · {data.division} · Auto-refreshes every 90s</div>
              <div>Built with Claude Code</div>
            </div>
          </>
        )}

        {/* Work Schedule view */}
        {view === 'work' && data && (
          <div>
            <div className="text-xs text-zinc-400 uppercase tracking-widest mb-3 px-1">Work Schedule</div>
            {data.workAssignments.length > 0 ? (
              <div className="space-y-2">
                {data.workAssignments.map((w, i) => (
                  <div key={i} className="bg-zinc-900 rounded-xl border border-zinc-700 px-4 py-3 flex items-center gap-4">
                    <div className="text-zinc-400 font-mono text-sm font-semibold w-28">{w.date} {w.time}</div>
                    <div>
                      <div className="text-zinc-300 text-sm">{w.play}</div>
                      <div className="text-zinc-500 text-xs">{w.court}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-zinc-900 rounded-xl border border-zinc-700 p-6 text-center text-zinc-400 text-sm">
                No work assignments scheduled right now.
              </div>
            )}
          </div>
        )}

        {/* Final Standings view — gated until the event is complete */}
        {view === 'standings' && data && (
          data.finalStandings && data.finalStandings.length > 0 ? (
            <div>
              <div className="text-xs text-zinc-400 uppercase tracking-widest mb-3 px-1">Final Standings</div>
              <div className="bg-zinc-900 rounded-xl border border-zinc-700 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-zinc-400 text-xs border-b border-zinc-700">
                      <th className="text-center px-3 py-2 w-10">Rank</th>
                      <th className="text-left px-3 py-2">Team</th>
                      <th className="text-right px-3 py-2 hidden sm:table-cell text-zinc-500">Bracket</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.finalStandings.map((s, i) => (
                      <tr key={i} className={`border-b border-zinc-700 last:border-0 ${s.isUs ? 'bg-yellow-950/40' : ''}`}>
                        <td className="text-center px-3 py-2.5">
                          <span className={`text-xs font-bold font-mono ${
                            s.overallRank === 1 ? 'text-yellow-400' :
                            s.overallRank <= 3 ? 'text-zinc-300' :
                            s.isUs ? 'text-yellow-500' :
                            'text-zinc-400'
                          }`}>
                            {s.tied ? 'T-' : ''}{s.overallRank}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`font-medium ${s.isUs ? 'text-yellow-300' : 'text-zinc-200'}`}>
                            {s.teamName}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right hidden sm:table-cell">
                          <span className="text-zinc-500 text-xs">{s.bracket}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-zinc-900 rounded-xl border border-zinc-700 p-8 text-center">
              <div className="text-4xl mb-3">🏆</div>
              <div className="text-white font-semibold mb-1">Final standings aren&apos;t in yet</div>
              <div className="text-zinc-400 text-sm">Coming at the end of the tournament — overall placements post once bracket play wraps up.</div>
            </div>
          )
        )}

        {/* Division Pool Play view — everyone's pools across the division */}
        {view === 'pools' && (
          <>
            {divisionLoading && !divisionData && (
              <div className="flex items-center justify-center py-20 text-zinc-400">Loading division pools…</div>
            )}
            {divisionData && (
              <div className="space-y-5">
                {divisionData.poolPlayComplete && (
                  <div className="bg-zinc-900 rounded-xl border border-emerald-800/60 p-5 text-center">
                    <div className="text-3xl mb-2">✅</div>
                    <div className="text-white font-semibold mb-1">Pool play is complete</div>
                    <div className="text-zinc-400 text-sm">
                      Head to <button onClick={() => openView('tracker')} className="text-yellow-400 underline">Live Tracker</button> and pick a team to follow bracket play.
                    </div>
                  </div>
                )}
                {(() => {
                  // Group pools by round (everything before "Pool N")
                  const groups: Record<string, DivisionPool[]> = {};
                  const order: string[] = [];
                  for (const p of divisionData.pools) {
                    const g = p.name.replace(/\s*Pool\b.*$/i, '').trim() || 'Pools';
                    if (!groups[g]) { groups[g] = []; order.push(g); }
                    groups[g].push(p);
                  }
                  return order.map(g => (
                    <div key={g} className="space-y-2">
                      {order.length > 1 && <div className="text-xs text-zinc-400 uppercase tracking-widest px-1">{g}</div>}
                      {groups[g].map(p => (
                        <div key={p.name} className="bg-zinc-900 rounded-xl border border-zinc-700 overflow-hidden">
                          <div className="px-3 py-2 border-b border-zinc-700 flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-white truncate">{p.name}</span>
                            {p.courts.length > 0 && <span className="text-xs text-zinc-500 shrink-0">{p.courts.join(' · ')}</span>}
                          </div>
                          <table className="w-full text-sm">
                            <tbody>
                              {p.standings.map((s, i) => {
                                // Highlight the focus team wherever it shows up
                                const isUs = !!selectedTeam && s.teamCode.toLowerCase() === selectedTeam.toLowerCase();
                                return (
                                  <tr key={i} className={`border-b border-zinc-800 last:border-0 ${isUs ? 'bg-yellow-950/40' : ''}`}>
                                    <td className="pl-3 py-2 w-6 text-center">
                                      {s.finishRank ? <span className={`text-xs font-bold ${isUs ? 'text-yellow-300' : 'text-zinc-300'}`}>{s.finishRank}</span> : <span className="text-zinc-600 text-xs">{i + 1}</span>}
                                    </td>
                                    <td className="px-2 py-2">
                                      <div className={isUs ? 'text-yellow-300 font-medium' : 'text-zinc-200'}>{s.teamName}</div>
                                      <div className="text-zinc-600 text-xs">{s.teamCode}</div>
                                    </td>
                                    <td className={`px-3 py-2 text-right text-xs whitespace-nowrap ${isUs ? 'text-yellow-400' : 'text-zinc-400'}`}>{s.matchesWon}-{s.matchesLost}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  ));
                })()}
              </div>
            )}
          </>
        )}

        {/* Starting Seeds view — pre-tournament overall ranking */}
        {view === 'seeds' && (
          <>
            {divisionLoading && !divisionData && (
              <div className="flex items-center justify-center py-20 text-zinc-400">Loading seeds…</div>
            )}
            {divisionData && (
              divisionData.seeds.length > 0 ? (
                <div>
                  <div className="text-xs text-zinc-400 uppercase tracking-widest mb-1 px-1">Tournament Seeding</div>
                  <div className="text-xs text-zinc-500 mb-3 px-1">Starting overall ranking · as seeded before play</div>
                  <div className="bg-zinc-900 rounded-xl border border-zinc-700 overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody>
                        {divisionData.seeds.map(s => {
                          const isUs = !!selectedTeam && s.teamCode.toLowerCase() === selectedTeam.toLowerCase();
                          return (
                            <tr key={s.teamCode} className={`border-b border-zinc-800 last:border-0 ${isUs ? 'bg-yellow-950/40' : ''}`}>
                              <td className="pl-3 py-2.5 w-10 text-center">
                                <span className={`text-xs font-bold font-mono ${isUs ? 'text-yellow-300' : s.seed <= 3 ? 'text-yellow-400' : 'text-zinc-400'}`}>{s.seed}</span>
                              </td>
                              <td className="px-2 py-2.5">
                                <div className={isUs ? 'text-yellow-300 font-medium' : 'text-zinc-200 font-medium'}>{s.teamName}</div>
                                {s.club && <div className="text-zinc-600 text-xs">{s.club}</div>}
                              </td>
                              <td className="px-3 py-2.5 text-right text-zinc-600 text-xs">{s.teamCode}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="bg-zinc-900 rounded-xl border border-zinc-700 p-8 text-center">
                  <div className="text-4xl mb-3">🔢</div>
                  <div className="text-white font-semibold mb-1">No starting seeds published</div>
                  <div className="text-zinc-400 text-sm">This tournament didn’t list a starting overall ranking. When an event seeds teams, they show up here.</div>
                </div>
              )
            )}
          </>
        )}

        {/* Court Play view — list floors, drill into one to see its teams */}
        {view === 'courts' && (
          <>
            {divisionLoading && !divisionData && (
              <div className="flex items-center justify-center py-20 text-zinc-400">Loading courts…</div>
            )}
            {divisionData && !selectedCourt && (
              <div>
                <div className="text-xs text-zinc-400 uppercase tracking-widest mb-1 px-1">Court Play</div>
                <div className="text-xs text-zinc-500 mb-3 px-1">Tap a floor to see which teams play there</div>
                {divisionData.courts.length === 0 ? (
                  <div className="bg-zinc-900 rounded-xl border border-zinc-700 p-6 text-center text-zinc-400 text-sm">No court assignments published yet.</div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {divisionData.courts.map(c => {
                      // Mark the floor(s) where the focus team is scheduled
                      const hasUs = !!selectedTeam && c.entries.some(e => e.teams.some(t => t.teamCode.toLowerCase() === selectedTeam.toLowerCase()));
                      return (
                        <button key={c.name} onClick={() => setSelectedCourt(c.name)}
                          className={`rounded-lg px-3 py-3 text-left border transition-colors ${hasUs ? 'bg-yellow-950/40 border-yellow-800/60 hover:border-yellow-700' : 'bg-zinc-900 border-zinc-700 hover:bg-zinc-800 hover:border-zinc-600'}`}>
                          <div className={`text-sm font-semibold ${hasUs ? 'text-yellow-300' : 'text-white'}`}>{c.name}</div>
                          <div className="text-xs text-zinc-500">{hasUs ? 'Your team plays here' : `${c.entries.length} pool${c.entries.length === 1 ? '' : 's'}`}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {divisionData && selectedCourt && (() => {
              const court = divisionData.courts.find(c => c.name === selectedCourt);
              return (
                <div className="space-y-3">
                  <button onClick={() => setSelectedCourt(null)} className="text-zinc-400 hover:text-zinc-200 text-sm">← All courts</button>
                  <div className="text-lg font-bold text-white px-1">{selectedCourt}</div>
                  {court?.entries.map((e, ei) => (
                    <div key={ei} className="bg-zinc-900 rounded-xl border border-zinc-700 overflow-hidden">
                      <div className="px-3 py-2 border-b border-zinc-700 flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-white truncate">{e.poolName}</span>
                        <span className="text-xs text-zinc-500 shrink-0">{e.date}{e.complete ? ' · done' : ''}</span>
                      </div>
                      <div className="divide-y divide-zinc-800">
                        {e.teams.map((t, ti) => {
                          const isUs = !!selectedTeam && t.teamCode.toLowerCase() === selectedTeam.toLowerCase();
                          return (
                            <div key={ti} className={`px-3 py-2 flex items-center justify-between gap-2 ${isUs ? 'bg-yellow-950/40' : ''}`}>
                              <span className={`text-sm ${isUs ? 'text-yellow-300 font-medium' : 'text-zinc-200'}`}>{t.teamName}</span>
                              <span className="text-zinc-600 text-xs">{t.teamCode}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
