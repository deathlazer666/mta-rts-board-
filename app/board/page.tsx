"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ROUTE_ORDER, routeInfo } from "@/lib/routes";
import { DEFAULT_STATION_ID, STATIONS } from "@/lib/stations";
import { fetchArrivals as fetchArrivalsRt, type ArrivalRow } from "@/lib/arrivals";

const SETTINGS_KEY = "mta-board:settings:v1";

type Settings = { stationId: string; minutes: number; routes: string[] };

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Settings;
      if (s.stationId && s.minutes && Array.isArray(s.routes)) return s;
    }
  } catch {}
  return { stationId: DEFAULT_STATION_ID, minutes: 30, routes: [] };
}

// Map a route id to its bundled line-icon SVG from nyc-subway-icons.
function lineIcon(id: string): string {
  const overrides: Record<string, string> = { SF: "s", SR: "s", SIR: "sir" };
  return `${overrides[id] ?? id.toLowerCase()}.svg`;
}

function fmtClock(epochSec: number, nowMs: number): string {
  const mins = Math.round((epochSec * 1000 - nowMs) / 60000);
  if (mins < 1) return "Now";
  if (mins <= 10) return `${mins} min`;
  return new Date(epochSec * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function BoardPage() {
  const [settings, setSettings] = useState<Settings>({ stationId: DEFAULT_STATION_ID, minutes: 30, routes: [] });
  const [hydrated, setHydrated] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [arrivals, setArrivals] = useState<ArrivalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setSettings(loadSettings());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings, hydrated]);

  const station = useMemo(
    () => STATIONS.find((s) => s.id === settings.stationId) ?? STATIONS[0],
    [settings.stationId],
  );

  // Live clock in New York time, formatted as a digital HH:MM:SS readout.
  const nyTime = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hourCycle: "h23",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(nowMs)),
    [nowMs],
  );

  const fetchArrivals = useCallback(async () => {
    if (!station) return;
    setLoading(true);
    setError(null);
    try {
      // Fetch MTA feeds directly in the browser so the app works standalone (e.g. in the APK).
      const { arrivals, errors } = await fetchArrivalsRt({
        stopIds: station.stopIds,
        minutes: settings.minutes,
      });
      setArrivals(arrivals);
      if (errors.length) setError(errors.join("; "));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setNowMs(Date.now());
    }
  }, [station, settings.minutes]);

  useEffect(() => {
    if (!hydrated) return;
    // Keep the clock / flash state in sync with the faster 12s refresh.
    fetchArrivals();
    const t = setInterval(fetchArrivals, 12000);
    return () => clearInterval(t);
  }, [hydrated, fetchArrivals]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const visible = useMemo(
    () => arrivals.filter((a) => settings.routes.length === 0 || settings.routes.includes(a.routeId)),
    [arrivals, settings.routes],
  );

  const activeRouteIds = useMemo(
    () => [...new Set(arrivals.map((a) => a.routeId))].sort(
      (a, b) => ROUTE_ORDER.indexOf(a) - ROUTE_ORDER.indexOf(b),
    ),
    [arrivals],
  );

  function toggleRoute(id: string) {
    setSettings((s) => ({
      ...s,
      routes: s.routes.includes(id) ? s.routes.filter((r) => r !== id) : [...s.routes, id],
    }));
  }

  return (
    <main className="min-h-screen bg-black text-[#e8edf2] font-sans">
      <header className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <button
          onClick={() => setShowSettings((v) => !v)}
          aria-label="Settings"
          title="Settings"
          className="rounded-full shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          <img
            src="/mta-logo.svg"
            alt="MTA logo"
            aria-hidden="true"
            className="w-10 h-10 rounded-full object-contain transition hover:scale-105 active:scale-95"
          />
        </button>
        <div className="flex items-center">
          <span className="text-2xl font-bold tabular-nums tracking-wide">{nyTime}</span>
        </div>
      </header>

      {showSettings && (
        <section className="px-5 py-4 border-b border-white/10 bg-white/5 space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <label className="text-sm">
              <span className="block text-white/60 mb-1">Station</span>
              <select
                value={settings.stationId}
                onChange={(e) => setSettings((s) => ({ ...s, stationId: e.target.value }))}
                className="bg-[#141a22] border border-white/15 rounded-md px-2 py-1.5 text-sm min-w-[220px]"
              >
                {STATIONS.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-white/60 mb-1">Time horizon</span>
              <select
                value={settings.minutes}
                onChange={(e) => setSettings((s) => ({ ...s, minutes: Number(e.target.value) }))}
                className="bg-[#141a22] border border-white/15 rounded-md px-2 py-1.5 text-sm"
              >
                {[10, 20, 30, 60, 120].map((m) => (
                  <option key={m} value={m}>{m} minutes</option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <p className="text-white/60 text-sm mb-2">
              Trains to display — {settings.routes.length === 0 ? "all" : `${settings.routes.length} selected`}
            </p>
            <div className="flex flex-wrap gap-2">
              {(activeRouteIds.length ? activeRouteIds : ROUTE_ORDER).map((id) => {
                const info = routeInfo(id);
                const on = settings.routes.length === 0 || settings.routes.includes(id);
                return (
                  <button
                    key={id}
                    onClick={() => toggleRoute(id)}
                    title={info.name}
                    aria-pressed={on}
                    className={`rounded transition ${on ? "opacity-100" : "opacity-25 grayscale"}`}
                  >
                    <img src={`/lines/${lineIcon(id)}`} alt={id} className="w-8 h-8" />
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="px-5 py-4">
        {error && <p className="text-red-400 text-sm mb-3">Feed error: {error}</p>}
        {loading && arrivals.length === 0 && <p className="text-white/50">Loading arrivals…</p>}
        {!loading && visible.length === 0 && !error && (
          <p className="text-white/50">No trains in the next {settings.minutes} minutes for the selected routes.</p>
        )}

        <ul className="flex flex-col gap-px">
          {visible.map((a, i) => {
            // Flashing like MTA boards: blink the whole row when the train is arriving now (< 1 min).
            const minsAway = (a.arrivalEpochSec * 1000 - nowMs) / 60000;
            const isArrivingNow = minsAway < 1;
            return (
              <li
                key={`${a.stopId}-${a.routeId}-${a.arrivalEpochSec}-${i}`}
                className={`flex items-center gap-5 px-4 py-4 bg-white/5 shadow-[0_6px_20px_rgba(0,0,0,0.35)] border border-white/5 ${isArrivingNow ? "flash-arriving" : ""}`}
              >
                <img
                  src={`/lines/${lineIcon(a.routeId)}`}
                  alt={`${a.routeId} train`}
                  className="w-10 h-10 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p
                    className="truncate font-bold leading-tight"
                    style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
                  >
                    {a.headsign}
                  </p>
                  <p className={`text-xs mt-0.5 ${isArrivingNow ? "text-black" : "text-white/50"}`}>
                    {a.direction === "N" ? "Northbound" : "Southbound"} · {a.stopId}
                  </p>
                </div>
                <span
                  className={`text-xl font-bold tabular-nums ${isArrivingNow ? "text-[#ffd23f]" : ""}`}
                  style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
                >
                  {fmtClock(a.arrivalEpochSec, nowMs)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
