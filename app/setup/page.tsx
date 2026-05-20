'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface TeamOption {
  teamId: string; teamName: string; teamCode: string; club: string; pool: string;
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
  const [step, setStep] = useState<'event' | 'team' | 'done'>('event');

  // Load existing config
  useEffect(() => {
    const savedEventId = localStorage.getItem('tracker_eventId');
    const savedDivisionId = localStorage.getItem('tracker_divisionId');
    const savedEventName = localStorage.getItem('tracker_eventName');
    const savedTeam = localStorage.getItem('tracker_defaultTeam');
    if (savedEventId) setEventId(savedEventId);
    if (savedDivisionId) setDivisionId(savedDivisionId);
    if (savedEventName) setEventName(savedEventName);
    if (savedTeam) setSelectedTeam(savedTeam);
    if (savedEventId && savedDivisionId) {
      setEventUrl(`https://results.advancedeventsystems.com/event/${savedEventId}/divisions/${savedDivisionId}/overview`);
    }
  }, []);

  const parseEventUrl = (url: string) => {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const eventIndex = pathParts.indexOf('event');
      const divisionsIndex = pathParts.indexOf('divisions');

      if (eventIndex >= 0 && divisionsIndex >= 0 && eventIndex + 1 < pathParts.length && divisionsIndex + 1 < pathParts.length) {
        return {
          eventId: pathParts[eventIndex + 1],
          divisionId: pathParts[divisionsIndex + 1],
        };
      }
      return null;
    } catch {
      return null;
    }
  };

  const fetchTeams = async () => {
    const parsed = parseEventUrl(eventUrl);
    if (!parsed) {
      setError('Invalid URL format. Please paste a full AES event URL like: https://results.advancedeventsystems.com/event/XXXXX/divisions/YYYYY/overview');
      return;
    }

    setEventId(parsed.eventId);
    setDivisionId(parsed.divisionId);
    setLoading(true);
    setError('');

    // Add timeout warning
    const timeoutWarning = setTimeout(() => {
      setError('Taking longer than expected... This may mean the event schedule hasn\'t been published yet, or the AES API is slow.');
    }, 15000);

    try {
      const res = await fetch(`/api/teams?event=${parsed.eventId}&division=${parsed.divisionId}`);
      clearTimeout(timeoutWarning);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);

      if (!json.teams || json.teams.length === 0) {
        setError('No teams found. The event schedule may not have been published yet.');
        return;
      }

      setTeams(json.teams || []);
      setEventName(json.event || '');
      setStep('team');
    } catch (e) {
      clearTimeout(timeoutWarning);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    const savedEventId = localStorage.getItem('tracker_eventId');
    // Clear team selection only if event actually changed
    if (savedEventId && savedEventId !== eventId) {
      localStorage.removeItem('tracker_defaultTeam');
    }
    localStorage.setItem('tracker_eventId', eventId);
    localStorage.setItem('tracker_divisionId', divisionId);
    localStorage.setItem('tracker_eventName', eventName);
    if (selectedTeam) {
      localStorage.setItem('tracker_defaultTeam', selectedTeam);
    }
    setStep('done');
    setTimeout(() => router.push('/'), 1000);
  };

  const handleSkipTeam = () => {
    const savedEventId = localStorage.getItem('tracker_eventId');
    // Clear team selection only if event actually changed
    if (savedEventId && savedEventId !== eventId) {
      localStorage.removeItem('tracker_defaultTeam');
    }
    localStorage.setItem('tracker_eventId', eventId);
    localStorage.setItem('tracker_divisionId', divisionId);
    localStorage.setItem('tracker_eventName', eventName);
    setStep('done');
    setTimeout(() => router.push('/'), 1000);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Tournament Tracker Setup</h1>
            <p className="text-zinc-500 text-sm">Configure your event and default team</p>
          </div>

          {step === 'event' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">
                  Event URL
                </label>
                <input
                  type="text"
                  value={eventUrl}
                  onChange={e => setEventUrl(e.target.value)}
                  placeholder="https://results.advancedeventsystems.com/event/XXXXX/divisions/YYYYY/overview"
                  className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm rounded-lg px-4 py-3 focus:outline-none focus:border-yellow-500 placeholder-zinc-600"
                />
                <p className="text-xs text-zinc-600 mt-1">
                  Paste the full AES event URL (from the divisions/overview page)
                </p>
              </div>

              {error && (
                <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-sm">{error}</div>
              )}

              <button
                onClick={fetchTeams}
                disabled={loading || !eventUrl}
                className="w-full bg-yellow-600 hover:bg-yellow-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium py-3 rounded-lg transition-colors"
              >
                {loading ? 'Loading teams…' : 'Continue'}
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
                <p className="text-xs text-zinc-600 mt-1">
                  This team will be selected by default on the tracker
                </p>
              </div>

              <div className="text-sm text-zinc-400 bg-zinc-800 rounded-lg p-3">
                <div className="font-medium text-zinc-300 mb-1">Event: {eventName}</div>
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
                onClick={() => setStep('event')}
                className="w-full text-zinc-500 hover:text-zinc-400 text-sm py-2"
              >
                ← Back
              </button>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center py-8">
              <div className="text-4xl mb-4">✓</div>
              <div className="text-lg font-medium text-white mb-2">Configuration Saved</div>
              <div className="text-zinc-500 text-sm">Redirecting to tracker…</div>
            </div>
          )}
        </div>

        <div className="mt-4 text-center">
          <button
            onClick={() => router.push('/')}
            className="text-zinc-600 hover:text-zinc-400 text-sm underline"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
