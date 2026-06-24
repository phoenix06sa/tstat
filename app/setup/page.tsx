'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface TeamOption {
  teamId: string; teamName: string; teamCode: string; club: string; pool: string;
}
interface EventResult {
  eventId: string; numericId: number; name: string;
  startDate: string; endDate: string; location: string; isPast: boolean;
}
interface DivisionOption { id: string; name: string }
interface CrossDivisionTeam extends TeamOption { divisionId: string; divisionName: string }

// "Jun 13–14, 2026" / "Jun 13, 2026" from two ISO dates
function fmtRange(start: string, end: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const s = start ? new Date(start.split('T')[0] + 'T12:00:00') : null;
  const e = end ? new Date(end.split('T')[0] + 'T12:00:00') : null;
  if (!s) return '';
  const year = (e || s).getFullYear();
  if (!e || s.getTime() === e.getTime()) return `${s.toLocaleDateString('en-US', opts)}, ${year}`;
  return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', opts)}, ${year}`;
}

export default function SetupPage() {
  const router = useRouter();
  const [eventUrl, setEventUrl] = useState('');
  const [eventId, setEventId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [eventName, setEventName] = useState('');
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'event' | 'division' | 'team' | 'done'>('event');

  // Search state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EventResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showUrl, setShowUrl] = useState(false);

  // Division state
  const [divisions, setDivisions] = useState<DivisionOption[]>([]);

  // "Search by team across all divisions" state (for when you don't know which
  // division a team is in — e.g. tracking a friend's team)
  const [teamSearchMode, setTeamSearchMode] = useState(false);
  const [allTeams, setAllTeams] = useState<CrossDivisionTeam[]>([]);
  const [loadingAllTeams, setLoadingAllTeams] = useState(false);
  const [teamQuery, setTeamQuery] = useState('');

  // Load existing config (so the URL field is prefilled if reconfiguring)
  useEffect(() => {
    const savedEventId = localStorage.getItem('tracker_eventId');
    const savedDivisionId = localStorage.getItem('tracker_divisionId');
    if (savedEventId && savedDivisionId) {
      setEventUrl(`https://results.advancedeventsystems.com/event/${savedEventId}/divisions/${savedDivisionId}/overview`);
    }
  }, []);

  // Debounced tournament search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/events?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (!cancelled) setResults(json.events || []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  const parseEventUrl = (url: string) => {
    try {
      const pathParts = new URL(url).pathname.split('/');
      const eventIndex = pathParts.indexOf('event');
      const divisionsIndex = pathParts.indexOf('divisions');
      if (eventIndex >= 0 && divisionsIndex >= 0 && eventIndex + 1 < pathParts.length && divisionsIndex + 1 < pathParts.length) {
        return { eventId: pathParts[eventIndex + 1], divisionId: pathParts[divisionsIndex + 1] };
      }
      return null;
    } catch {
      return null;
    }
  };

  // Load teams for a chosen event + division, then advance to team selection
  const loadTeams = async (evId: string, divId: string) => {
    setLoading(true);
    setError('');
    const timeoutWarning = setTimeout(() => {
      setError('Taking longer than expected… the event schedule may not be published yet, or AES is slow.');
    }, 15000);
    try {
      const res = await fetch(`/api/teams?event=${evId}&division=${divId}`);
      clearTimeout(timeoutWarning);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      if (!json.teams || json.teams.length === 0) {
        setError('No teams found. The schedule may not be published yet.');
        return;
      }
      setTeams(json.teams);
      setEventName(json.event || eventName);
      setStep('team');
    } catch (e) {
      clearTimeout(timeoutWarning);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // From the paste-a-URL field
  const continueFromUrl = () => {
    const parsed = parseEventUrl(eventUrl);
    if (!parsed) {
      setError('Invalid URL. Paste a full AES event URL like: https://results.advancedeventsystems.com/event/XXXXX/divisions/YYYYY/overview');
      return;
    }
    setEventId(parsed.eventId);
    setDivisionId(parsed.divisionId);
    loadTeams(parsed.eventId, parsed.divisionId);
  };

  // Load every team across all divisions for the chosen event, so a team can
  // be found by name without knowing its division first.
  const enterTeamSearch = async () => {
    setTeamSearchMode(true);
    setError('');
    if (allTeams.length > 0) return; // already loaded for this event
    setLoadingAllTeams(true);
    try {
      const res = await fetch(`/api/event-teams?event=${eventId}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setAllTeams(json.teams || []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingAllTeams(false);
    }
  };

  // Pick a team from the cross-division search: lock in its division and team,
  // then go to the confirm/team step with that division's teams loaded.
  const pickTeamAcrossDivisions = (t: CrossDivisionTeam) => {
    setTeams(allTeams.filter(x => x.divisionId === t.divisionId));
    setDivisionId(t.divisionId);
    setSelectedTeam(t.teamCode);
    setTeamSearchMode(false);
    setError('');
    setStep('team');
  };

  // From a search result: load the event's divisions, then pick one
  const pickEvent = async (ev: EventResult) => {
    setEventId(ev.eventId);
    setEventName(ev.name);
    setDivisionId('');
    setError('');
    // New event — drop any cross-division teams cached for the previous one
    setAllTeams([]);
    setTeamSearchMode(false);
    setTeamQuery('');
    setLoading(true);
    try {
      const res = await fetch(`/api/event-info?event=${ev.eventId}`);
      const json = await res.json();
      const divs: DivisionOption[] = json.divisions || [];
      setDivisions(divs);
      if (divs.length === 1) {
        setDivisionId(divs[0].id);
        await loadTeams(ev.eventId, divs[0].id);
      } else {
        setStep('division');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    localStorage.removeItem('tracker_defaultTeam');
    localStorage.setItem('tracker_eventId', eventId);
    localStorage.setItem('tracker_divisionId', divisionId);
    localStorage.setItem('tracker_eventName', eventName);
    if (selectedTeam) {
      localStorage.setItem('tracker_defaultTeam', selectedTeam);
      const saved = JSON.parse(localStorage.getItem('tracker_savedTournaments') || '[]');
      const exists = saved.some((s: { eventId: string; divisionId: string; teamCode: string }) =>
        s.eventId === eventId && s.divisionId === divisionId && s.teamCode === selectedTeam);
      if (!exists) {
        const teamObj = teams.find(t => t.teamCode === selectedTeam);
        saved.push({ eventId, divisionId, eventName, teamCode: selectedTeam, teamName: teamObj?.teamName || '', addedAt: Date.now() });
        localStorage.setItem('tracker_savedTournaments', JSON.stringify(saved));
      }
    }
    setStep('done');
    setTimeout(() => router.push('/'), 1000);
  };

  const handleSkipTeam = () => {
    localStorage.removeItem('tracker_defaultTeam');
    localStorage.setItem('tracker_eventId', eventId);
    localStorage.setItem('tracker_divisionId', divisionId);
    localStorage.setItem('tracker_eventName', eventName);
    setStep('done');
    setTimeout(() => router.push('/'), 1000);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-zinc-900 rounded-xl border border-zinc-700 p-6 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Tournament Tracker Setup</h1>
            <p className="text-zinc-400 text-sm">Search for your tournament, or paste its AES link</p>
          </div>

          {step === 'event' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">
                  Search tournaments
                </label>
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="e.g. FAST Pre Nationals"
                  autoFocus
                  className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm rounded-lg px-4 py-3 focus:outline-none focus:border-yellow-500 placeholder-zinc-500"
                />
              </div>

              {/* Results */}
              {query.trim().length >= 2 && (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {searching && results.length === 0 && (
                    <div className="text-zinc-500 text-sm py-2 text-center">Searching…</div>
                  )}
                  {!searching && results.length === 0 && (
                    <div className="text-zinc-500 text-sm py-2 text-center">No tournaments found</div>
                  )}
                  {results.map(ev => (
                    <button
                      key={ev.eventId}
                      onClick={() => pickEvent(ev)}
                      disabled={loading}
                      className="w-full text-left bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-zinc-700 rounded-lg px-4 py-3 transition-colors"
                    >
                      <div className="text-sm font-medium text-zinc-100">{ev.name}</div>
                      <div className="text-xs text-zinc-400 mt-0.5">
                        {fmtRange(ev.startDate, ev.endDate)}
                        {ev.location ? ` · ${ev.location}` : ''}
                        {ev.isPast ? ' · past' : ''}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {error && (
                <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-sm">{error}</div>
              )}

              {/* Paste-a-URL fallback */}
              <div className="pt-2 border-t border-zinc-800">
                {!showUrl ? (
                  <button
                    onClick={() => setShowUrl(true)}
                    className="text-zinc-400 hover:text-zinc-200 text-sm"
                  >
                    Or paste an AES event URL →
                  </button>
                ) : (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-zinc-300">Event URL</label>
                    <input
                      type="text"
                      value={eventUrl}
                      onChange={e => setEventUrl(e.target.value)}
                      placeholder="https://results.advancedeventsystems.com/event/XXXXX/divisions/YYYYY/overview"
                      className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm rounded-lg px-4 py-3 focus:outline-none focus:border-yellow-500 placeholder-zinc-500"
                    />
                    <button
                      onClick={continueFromUrl}
                      disabled={loading || !eventUrl}
                      className="w-full bg-yellow-600 hover:bg-yellow-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium py-3 rounded-lg transition-colors"
                    >
                      {loading ? 'Loading…' : 'Continue'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'division' && (
            <div className="space-y-4">
              <div className="text-sm text-zinc-400 bg-zinc-800 rounded-lg p-3">
                <div className="font-medium text-zinc-200">{eventName}</div>
                <div className="text-xs">{divisions.length} divisions</div>
              </div>

              {!teamSearchMode ? (
                <>
                  {/* Option 1: pick the division, then the team (original flow) */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-2">Division</label>
                    <select
                      value={divisionId}
                      onChange={e => setDivisionId(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm rounded-lg px-4 py-3 focus:outline-none focus:border-yellow-500"
                    >
                      <option value="">-- Select a division --</option>
                      {divisions.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>

                  {error && (
                    <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-sm">{error}</div>
                  )}

                  <button
                    onClick={() => divisionId && loadTeams(eventId, divisionId)}
                    disabled={loading || !divisionId}
                    className="w-full bg-yellow-600 hover:bg-yellow-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium py-3 rounded-lg transition-colors"
                  >
                    {loading ? 'Loading teams…' : 'Continue'}
                  </button>

                  {/* Option 2: don't know the division? search by team name */}
                  <div className="pt-2 border-t border-zinc-800">
                    <button
                      onClick={enterTeamSearch}
                      className="text-zinc-400 hover:text-zinc-200 text-sm"
                    >
                      Don&apos;t know the division? Search by team name →
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* Team search across every division in the event */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-2">Search team name</label>
                    <input
                      type="text"
                      value={teamQuery}
                      onChange={e => setTeamQuery(e.target.value)}
                      placeholder="e.g. CTX Juniors 12 Mizuno"
                      autoFocus
                      className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm rounded-lg px-4 py-3 focus:outline-none focus:border-yellow-500 placeholder-zinc-500"
                    />
                    <p className="text-xs text-zinc-500 mt-1">
                      Searches all {divisions.length} divisions — its division is picked for you.
                    </p>
                  </div>

                  {error && (
                    <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-sm">{error}</div>
                  )}

                  {loadingAllTeams ? (
                    <div className="text-zinc-500 text-sm py-2 text-center">
                      Loading teams across {divisions.length} divisions…
                    </div>
                  ) : teamQuery.trim().length >= 2 && (() => {
                    const q = teamQuery.trim().toLowerCase();
                    const matches = allTeams
                      .filter(t => t.teamName.toLowerCase().includes(q) || (t.club || '').toLowerCase().includes(q))
                      .slice(0, 40);
                    if (matches.length === 0) {
                      return <div className="text-zinc-500 text-sm py-2 text-center">No teams match “{teamQuery.trim()}”</div>;
                    }
                    return (
                      <div className="space-y-2 max-h-80 overflow-y-auto">
                        {matches.map(t => (
                          <button
                            key={`${t.divisionId}-${t.teamCode}`}
                            onClick={() => pickTeamAcrossDivisions(t)}
                            className="w-full text-left bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-4 py-3 transition-colors"
                          >
                            <div className="text-sm font-medium text-zinc-100">{t.teamName}</div>
                            <div className="text-xs text-zinc-400 mt-0.5">{t.divisionName} · {t.teamCode}</div>
                          </button>
                        ))}
                      </div>
                    );
                  })()}

                  <div className="pt-2 border-t border-zinc-800">
                    <button
                      onClick={() => { setTeamSearchMode(false); setError(''); }}
                      className="text-zinc-400 hover:text-zinc-200 text-sm"
                    >
                      ← Pick a division from the list instead
                    </button>
                  </div>
                </>
              )}

              <button
                onClick={() => { setStep('event'); setTeamSearchMode(false); setError(''); }}
                className="w-full text-zinc-400 hover:text-zinc-200 text-sm py-2"
              >
                ← Back to search
              </button>
            </div>
          )}

          {step === 'team' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">
                  Default Team
                </label>
                <select
                  value={selectedTeam}
                  onChange={e => setSelectedTeam(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm rounded-lg px-4 py-3 focus:outline-none focus:border-yellow-500"
                >
                  <option value="">-- Select a team (optional) --</option>
                  {teams.map(t => (
                    <option key={t.teamCode} value={t.teamCode}>
                      {t.teamName} ({t.teamCode}) - {t.pool}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-zinc-500 mt-1">
                  This team will be selected by default on the tracker
                </p>
              </div>

              <div className="text-sm text-zinc-400 bg-zinc-800 rounded-lg p-3">
                <div className="font-medium text-zinc-200 mb-1">Event: {eventName}</div>
                <div className="text-xs">{teams.length} teams found</div>
              </div>

              <button
                onClick={handleSave}
                className="w-full bg-yellow-600 hover:bg-yellow-500 text-white font-medium py-3 rounded-lg transition-colors"
              >
                Save & Continue
              </button>

              <button
                onClick={handleSkipTeam}
                className="w-full bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-medium py-3 rounded-lg transition-colors"
              >
                Skip (select team later)
              </button>

              <button
                onClick={() => { setStep(divisions.length > 1 ? 'division' : 'event'); setError(''); }}
                className="w-full text-zinc-400 hover:text-zinc-200 text-sm py-2"
              >
                ← Back
              </button>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center py-8">
              <div className="text-4xl mb-4">✓</div>
              <div className="text-lg font-medium text-white mb-2">Configuration Saved</div>
              <div className="text-zinc-400 text-sm">Redirecting to tracker…</div>
            </div>
          )}
        </div>

        <div className="mt-4 text-center">
          <button
            onClick={() => router.push('/')}
            className="text-zinc-500 hover:text-zinc-300 text-sm underline"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
