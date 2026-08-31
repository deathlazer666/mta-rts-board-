"use client";

import { useState } from "react";
import Link from "next/link";
import { geocodeAddress } from "@/lib/geocode";
import { planRoute, routeLineIcon, type RouteResult } from "@/lib/directions";
import { ROUTES } from "@/lib/routes";

const FONT = { fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" };

function ft(meters: number): string {
  return `${Math.max(1, Math.round(meters * 3.28084))} ft`;
}

export default function DirectionsPage() {
  const [start, setStart] = useState("");
  const [dest, setDest] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [fromLabel, setFromLabel] = useState<string | null>(null);
  const [toLabel, setToLabel] = useState<string | null>(null);

  async function onGo() {
    if (!start.trim() || !dest.trim()) {
      setError("Enter both a start address and a destination address.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setFromLabel(null);
    setToLabel(null);
    try {
      const [from, to] = await Promise.all([geocodeAddress(start), geocodeAddress(dest)]);
      const route = planRoute(from, to);
      setFromLabel(from.label);
      setToLabel(to.label);
      setResult(route);
    } catch (e) {
      setError((e as Error).message || "Couldn't plan that trip. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-[#e8edf2] font-sans">
      <header className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <img src="/mta-logo.svg" alt="MTA logo" className="w-10 h-10 rounded-full object-contain" />
          <div>
            <p className="text-lg font-bold leading-tight" style={FONT}>
              Directions
            </p>
            <p className="text-xs text-white/50" style={FONT}>
              Subway & bus trip planner
            </p>
          </div>
        </div>
        <Link
          href="/board"
          className="px-4 py-2 rounded border border-white/15 text-sm font-bold hover:bg-white/10"
          style={FONT}
        >
          ← Board
        </Link>
      </header>

      <section className="px-5 py-4 border-b border-white/10 bg-white/5 space-y-3">
        <label className="block text-sm">
          <span className="block text-white/60 mb-1" style={FONT}>
            Start
          </span>
          <input
            value={start}
            onChange={(e) => setStart(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onGo()}
            placeholder="e.g. 123 Main St, Brooklyn NY"
            className="w-full bg-[#141a22] border border-white/15 rounded-md px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#ffd23f]"
            style={FONT}
          />
        </label>
        <label className="block text-sm">
          <span className="block text-white/60 mb-1" style={FONT}>
            Destination
          </span>
          <input
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onGo()}
            placeholder="e.g. 150-45 88th Av, Queens NY"
            className="w-full bg-[#141a22] border border-white/15 rounded-md px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#ffd23f]"
            style={FONT}
          />
        </label>
        <button
          onClick={onGo}
          disabled={loading}
          className="w-full py-2.5 rounded bg-[#ffd23f] text-black text-sm font-bold disabled:opacity-50"
          style={FONT}
        >
          {loading ? "Finding route…" : "Get directions"}
        </button>
        {error && (
          <p className="text-sm text-[#ed0a02]" style={FONT}>
            {error}
          </p>
        )}
      </section>

      {result && (
        <section className="px-5 py-4 space-y-4">
          {result.legs.length === 0 ? (
            <div className="px-4 py-6 border border-white/10 bg-white/5 text-center">
              <p className="text-lg font-bold text-[#ffd23f]" style={FONT}>
                You're already close — just walk
              </p>
              <p className="text-sm text-white/60 mt-2" style={FONT}>
                {ft(result.walkFromMeters + result.walkToMeters)} from the start address to {result.endStation}.
              </p>
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border border-white/10 bg-white/5 flex flex-wrap gap-x-6 gap-y-1">
                <p className="text-sm" style={FONT}>
                  <span className="text-white/50">From</span>{" "}
                  <span className="font-bold text-[#ffd23f]">{result.startStation}</span>
                  {fromLabel && <span className="text-white/40"> · {fromLabel}</span>}
                </p>
                <p className="text-sm" style={FONT}>
                  <span className="text-white/50">To</span>{" "}
                  <span className="font-bold text-[#ffd23f]">{result.endStation}</span>
                  {toLabel && <span className="text-white/40"> · {toLabel}</span>}
                </p>
                <p className="text-sm text-white/60" style={FONT}>
                  {result.transfers} transfer{result.transfers === 1 ? "" : "s"} · {result.stops} stops
                </p>
              </div>

              <ol className="space-y-3">
                <li className="flex items-center gap-3 px-4 py-3 border border-white/10 bg-white/5">
                  <span className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold text-[#ffd23f] shrink-0" style={FONT}>
                    1
                  </span>
                  <p className="text-sm" style={FONT}>
                    Walk to <span className="font-bold">{result.startStation}</span>{" "}
                    <span className="text-white/50">({ft(result.walkFromMeters)})</span>
                  </p>
                </li>

                {result.legs.map((leg, i) => {
                  const next = result.legs[i + 1];
                  return (
                    <li key={`${leg.line}-${i}`} className="px-4 py-3 border border-white/10 bg-white/5">
                      <div className="flex items-center gap-3">
                        <span
                          className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold text-[#ffd23f] shrink-0"
                          style={FONT}
                        >
                          {i + 2}
                        </span>
                        {leg.mode === "bus" ? (
                          <span
                            className="w-10 h-10 rounded-md bg-[#ffd23f] text-black flex items-center justify-center text-sm font-extrabold shrink-0"
                            style={FONT}
                          >
                            {leg.shortName}
                          </span>
                        ) : (
                          <img
                            src={`/lines/${routeLineIcon(leg.line)}`}
                            alt={leg.line}
                            className="w-9 h-9 shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="font-bold" style={FONT}>
                            {leg.mode === "bus" ? (
                              <>
                                {leg.shortName} bus
                                {leg.routeName && <span className="text-white/50 font-normal"> · {leg.routeName}</span>}
                              </>
                            ) : (
                              <>
                                {leg.line} train
                                <span className="text-white/50 font-normal"> · {ROUTES[leg.line]?.name ?? "Subway"}</span>
                              </>
                            )}
                          </p>
                          <p className="text-sm text-white/70" style={FONT}>
                            {leg.hops} stop{leg.hops === 1 ? "" : "s"}
                            {leg.headsign ? ` · toward ${leg.headsign}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 pl-11">
                        <ol className="relative" style={FONT}>
                          {leg.stops.map((name, k) => {
                            const isStart = k === 0;
                            const isEnd = k === leg.stops.length - 1;
                            const isTransfer = isEnd && !!next;
                            return (
                              <li key={k} className="flex items-center gap-2.5 text-sm">
                                <span
                                  className={`w-2 h-2 rounded-full shrink-0 ${
                                    isStart
                                      ? "bg-white/20"
                                      : isEnd
                                        ? "bg-[#ffd23f]"
                                        : "bg-white/40"
                                  }`}
                                />
                                <span
                                  className={`${
                                    isStart || isEnd ? "font-bold" : "text-white/80"
                                  } ${isEnd ? "text-[#ffd23f]" : ""}`}
                                >
                                  {name}
                                </span>
                                {isStart && <span className="text-white/40 text-xs">BOARD</span>}
                                {isEnd && next && (
                                  <span className="text-white/60 text-xs">
                                    transfer to{" "}
                                    <span className="font-bold">
                                      {next.mode === "bus" ? next.shortName : next.line}
                                    </span>
                                  </span>
                                )}
                                {isEnd && !next && (
                                  <span className="text-white/40 text-xs">GET OFF</span>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    </li>
                  );
                })}

                <li className="flex items-center gap-3 px-4 py-3 border border-white/10 bg-white/5">
                  <span className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold text-[#ffd23f] shrink-0" style={FONT}>
                    {result.legs.length + 2}
                  </span>
                  <p className="text-sm" style={FONT}>
                    Walk to your destination{" "}
                    <span className="text-white/50">({ft(result.walkToMeters)})</span>
                  </p>
                </li>
              </ol>
            </>
          )}
        </section>
      )}

      {!result && !loading && (
        <p className="px-5 py-4 text-sm text-white/40" style={FONT}>
          Enter a start and destination address in New York City to get step-by-step subway and bus directions.
        </p>
      )}
    </main>
  );
}
