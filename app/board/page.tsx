"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ROUTE_ORDER, lineDesignation, routeInfo } from "@/lib/routes";
import { DEFAULT_STATION_ID, STATIONS, STATION_GROUPS, type Station } from "@/lib/stations";
import { fetchArrivals as fetchArrivalsRt, type ArrivalRow } from "@/lib/arrivals";
import { fetchLineStatus, type LineStatusRow } from "@/lib/alerts";
import QrScanner from "./qr-scan";

const SETTINGS_KEY = "mta-board:settings:v1";

type Settings = { stationId: string; minutes: number; routes: string[]; showAlerts: boolean };

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Settings;
      if (s.stationId && s.minutes && Array.isArray(s.routes)) {
        return { ...s, showAlerts: s.showAlerts === true };
      }
    }
  } catch {}
  return { stationId: DEFAULT_STATION_ID, minutes: 30, routes: [], showAlerts: false };
}

// Map a route id to its bundled line-icon SVG from nyc-subway-icons.
function lineIcon(id: string): string {
  // All shuttle-designated route ids share the NYCS standard S bullet.
  const overrides: Record<string, string> = {
    S: "s", GS: "s", FS: "s", H: "s", SF: "s", SR: "s", SIR: "sir",
    // 7X = Flushing Express: use the diamond 7 bullet. 6X / FX (rush-hour
    // expresses) fall back to their base-line bullet until diamond assets exist.
    "7X": "7x", "7x": "7x", "6X": "6", "FX": "f",
  };
  return `${overrides[id] ?? id.toLowerCase()}.svg`;
}

// Format a feed-reported delay (seconds) as a short "Delayed X min" notice.
function fmtDelay(delaySec: number): string {
  const mins = Math.max(1, Math.round(delaySec / 60));
  return `Delayed ${mins} min`;
}

function fmtClock(epochSec: number, nowMs: number): string {
  const mins = Math.round((epochSec * 1000 - nowMs) / 60000);
  if (mins < 1) return "Now";
  return `${mins} min`;
}

// Format an epoch second as a New York wall-clock time (12h).
function fmtNyTime(epochSec: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(epochSec * 1000));
}

export default function BoardPage() {
  const [settings, setSettings] = useState<Settings>({ stationId: DEFAULT_STATION_ID, minutes: 30, routes: [], showAlerts: false });
  const [hydrated, setHydrated] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [arrivals, setArrivals] = useState<ArrivalRow[]>([]);
  const [lineStatus, setLineStatus] = useState<LineStatusRow[]>([]);
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

  // Routes the selected station actually serves (from its live arrivals), used to
  // scope the MTA service-alert feed even when no route filter is set.
  const stationRoutes = useMemo(
    () =>
      settings.routes.length > 0
        ? settings.routes
        : [...new Set(arrivals.map((a) => a.routeId))].filter((r) =>
            ROUTE_ORDER.includes(r),
          ),
    [settings.routes, arrivals],
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
    if (!hydrated) return;
    if (!settings.showAlerts) {
      setLineStatus([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        // Per-line service status, decoded from the MTA Mercury extension in the
        // per-line GTFS-RT feeds (there is no separate subway gtfs-alerts key).
        setLineStatus(
          await fetchLineStatus({
            stopIds: station?.stopIds ?? [],
            routeIds: stationRoutes.length > 0 ? stationRoutes : null,
          }),
        );
      } catch {
        if (!cancelled) setLineStatus([]);
      }
    };
    run();
    const t = setInterval(run, 12000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [hydrated, settings.showAlerts, stationRoutes, station]);

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

  // Stable callbacks so the scanner overlay never restarts its camera stream
  // when the page re-renders (e.g. the clock tick every second).
  const closeQr = useCallback(() => setQrOpen(false), []);
  const handleQrStation = useCallback((st: Station) => setSettings((s) => ({ ...s, stationId: st.id })), []);

  return (
    <main className="min-h-screen bg-black text-[#e8edf2] font-sans">
      <header className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
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
          <button
            onClick={() => setQrOpen(true)}
            aria-label="Scan station QR code"
            title="Scan station QR code"
            className="shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            <svg
              viewBox="0 0 24 24"
              className="w-7 h-7 text-[#ffd23f] transition hover:scale-105 active:scale-95"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <path d="M14 14h3v3h-3zM21 14h0M14 21h0M18 18h3v3h-3zM21 18h0" />
            </svg>
          </button>
        </div>
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
                className="bg-[#141a22] border border-white/15 rounded-md px-2 py-1.5 text-sm min-w-[260px]"
              >
                {STATION_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.stations.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </optgroup>
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
                {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130].map((m) => (
                  <option key={m} value={m}>{m} minutes</option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex items-center gap-3 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={settings.showAlerts}
              onChange={(e) => setSettings((s) => ({ ...s, showAlerts: e.target.checked }))}
              className="h-4 w-4 accent-[#ffd23f]"
            />
            <span className="font-bold" style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
              Active alerts
            </span>
            <span className="text-white/40 text-xs">show service alerts below trains</span>
          </label>

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
            // Flashing like MTA boards: blink the whole row while the countdown
            // reads "1 min" or "Now". Color follows the displayed text: "1 min"
            // is yellow, "Now" is green.
            const clockText = fmtClock(a.arrivalEpochSec, nowMs);
            const isNow = clockText === "Now";
            const isOneMin = clockText === "1 min";
            const isFlashRow = isNow || isOneMin;
            // 2-4 min countdowns render in MTA green; 100+ min rows are flagged red.
            const minsLabel = clockText.match(/^(\d+) min$/)?.[1];
            const isGreenMin = minsLabel != null && Number(minsLabel) >= 2 && Number(minsLabel) <= 4;
            const isFar = minsLabel != null && Number(minsLabel) >= 100;
            return (
              <li
                key={`${a.stopId}-${a.routeId}-${a.arrivalEpochSec}-${i}`}
                className={`flex items-center gap-5 px-4 py-4 bg-white/5 shadow-[0_6px_20px_rgba(0,0,0,0.35)] border border-white/5 ${isFlashRow ? "flash-arriving" : ""}`}
              >
                <img
                  src={`/lines/${lineIcon(a.routeId)}`}
                  alt={`${a.routeId} train`}
                  className={`w-10 h-10 shrink-0 ${isFar ? "logo-red" : ""}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p
                      className={`truncate font-bold leading-tight ${isFar ? "text-[#ed0a02]" : ""}`}
                      style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
                    >
                      {isFar ? `evil ${a.routeId} train` : a.headsign}
                    </p>
                    {(() => {
                      const des = lineDesignation(a.routeId, nowMs);
                      if (!des) return null;
                      const express = des === "Express";
                      return (
                        <span
                          className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 border rounded leading-none ${
                            express ? "text-[#AB037E] border-[#AB037E]" : "text-[#030EAB] border-[#030EAB]"
                          }`}
                          style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
                        >
                          {des}
                        </span>
                      );
                    })()}
                  </div>
                  <p className={`text-xs mt-0.5 ${isFlashRow ? "text-black" : "text-white/50"}`}>
                    {a.direction === "N" ? "Northbound" : "Southbound"} · {a.stopId}
                  </p>
                  {(() => {
                    const isDelayed = (a.delaySec ?? 0) >= 60;
                    if (!a.skipped && !isDelayed) return null;
                    return (
                      <p
                        className="text-xs font-bold mt-0.5 text-[#ffd23f]"
                        style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
                      >
                        {a.skipped ? "Not stopping at this station" : ""}
                        {a.skipped && isDelayed ? " · " : ""}
                        {isDelayed ? fmtDelay(a.delaySec ?? 0) : ""}
                      </p>
                    );
                  })()}
                </div>
                <span
                  className={`text-xl font-bold tabular-nums ${
                    isNow || isOneMin
                      ? "text-[#ffd23f]"
                      : isGreenMin
                        ? "text-[#128F00]"
                        : isFar
                          ? "text-[#ed0a02]"
                          : ""
                  }`}
                  style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
                >
                  {clockText}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <QrScanner
        open={qrOpen}
        onClose={closeQr}
        onStation={handleQrStation}
      />

      {settings.showAlerts && (
        <section className="px-5 py-4 border-t border-white/10 space-y-3">
          <h3
            className="text-sm font-bold text-white/80 uppercase tracking-wider"
            style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
          >
            Service Status
          </h3>
          {!loading && lineStatus.length === 0 && (
            <p className="text-white/40 text-sm">No service-status data available for this station right now.</p>
          )}
          {lineStatus.map((row) => (
            <div key={row.routeId} className="flex items-center gap-4 px-4 py-3 bg-white/5 border border-white/10">
              <img
                src={`/lines/${lineIcon(row.routeId)}`}
                alt={row.routeId}
                className="w-9 h-9 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p
                  className={`text-[15px] font-bold ${row.good ? "text-[#5fd45f]" : "text-[#ffd23f]"}`}
                  style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
                >
                  {row.status}
                </p>
                {row.header && row.header !== row.status && !row.good && (
                  <p className="text-xs text-white/70 mt-0.5 line-clamp-2 whitespace-pre-line">{row.header}</p>
                )}
              </div>
              {row.resumeSec ? (
                <span
                  className="text-xs font-bold text-white/60 shrink-0"
                  style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
                >
                  Resumes {fmtNyTime(row.resumeSec)}
                </span>
              ) : row.good ? (
                <span
                  className="text-xs font-bold text-white/50 shrink-0"
                  style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
                >
                  On time
                </span>
              ) : null}
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
