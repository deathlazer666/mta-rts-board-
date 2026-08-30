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
    fetchArrivals();
    const t = setInterval(fetchArrivals, 30000);
    return () => clearInterval(t);
  }, [hydrated, fetchArrivals]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15000);
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
    <main className="min-h-screen bg-[#0b0f14] text-[#e8edf2] font-sans">
      <header className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#0039A6] flex items-center justify-center text-white font-black">
            M
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">Real-Time Train Board</h1>
            <p className="text-xs text-white/50">{station?.name ?? "Select station"} · updates every 30s</p>
          </div>
        </div>
        <button
          onClick={() => setShowSettings((v) => !v)}
          className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-sm font-medium"
        >
          ⚙ Settings
        </button>
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
                    className={`px-2.5 py-1 rounded-full text-xs font-bold border transition
                      ${on ? "opacity-100" : "opacity-30 grayscale"}`}
                    style={{ backgroundColor: info.color, color: info.textColor, borderColor: info.color }}
                  >
                    {id}
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

        <ul className="divide-y divide-white/5">
          {visible.map((a, i) => {
            const info = routeInfo(a.routeId);
            return (
              <li key={`${a.stopId}-${a.routeId}-${a.arrivalEpochSec}-${i}`} className="flex items-center gap-4 py-3">
                <span
                  className="w-10 h-10 rounded-full flex items-center justify-center font-black text-lg shrink-0"
                  style={{ backgroundColor: info.color, color: info.textColor }}
                >
                  {a.routeId}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium">{a.headsign}</p>
                  <p className="text-xs text-white/50">
                    {a.direction === "N" ? "Northbound" : "Southbound"} · {a.stopId}
                  </p>
                </div>
                <span className="text-xl font-bold tabular-nums">{fmtClock(a.arrivalEpochSec, nowMs)}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
