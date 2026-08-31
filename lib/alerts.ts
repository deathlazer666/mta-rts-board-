// Client-safe GTFS-RT active-alerts fetcher. Reads the Alert entities from the
// same MTA feeds used for arrivals and extracts the ones relevant to the
// selected station / routes. Works in the browser (bundled) and in Node.
import * as GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { FEEDS, feedKeyForStopId } from "@/lib/arrivals";

export type AlertRow = {
  header: string;
  description?: string;
  startSec?: number;
  endSec?: number;
  /** Latest end of the alert = when normal service resumes. */
  resumeSec?: number;
  /** Human-readable delay cause reported by the feed. */
  cause?: string;
  /** Route ids affected by this alert. */
  routes: string[];
};

// GTFS-RT TransitAlert.Cause enum (numeric protobuf + name forms).
const CAUSE_LABELS: Record<string, string> = {
  "1": "Unknown",
  "2": "Other",
  "3": "Technical problem",
  "4": "Strike",
  "5": "Demonstration",
  "6": "Accident",
  "7": "Holiday",
  "8": "Weather",
  "9": "Maintenance",
  "10": "Construction",
  "11": "Police activity",
  "12": "Medical emergency",
  UNKNOWN_CAUSE: "Unknown",
  OTHER_CAUSE: "Other",
  TECHNICAL_PROBLEM: "Technical problem",
  STRIKE: "Strike",
  DEMONSTRATION: "Demonstration",
  ACCIDENT: "Accident",
  HOLIDAY: "Holiday",
  WEATHER: "Weather",
  MAINTENANCE: "Maintenance",
  CONSTRUCTION: "Construction",
  POLICE_ACTIVITY: "Police activity",
  MEDICAL_EMERGENCY: "Medical emergency",
};

function causeLabel(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  return CAUSE_LABELS[String(raw)];
}

function protoSec(t: unknown): number | undefined {
  if (t == null) return undefined;
  if (typeof t === "number") return t;
  if (typeof t === "object" && t !== null) {
    const obj = t as { toNumber?: () => number; low?: number; high?: number };
    if (typeof obj.toNumber === "function") return obj.toNumber();
    if (typeof obj.low === "number" && typeof obj.high === "number") {
      return obj.low + obj.high * 4294967296;
    }
  }
  return undefined;
}

function transString(ts: unknown): string {
  if (ts == null) return "";
  if (typeof ts === "string") return ts;
  const obj = ts as { translation?: Array<{ text?: string }> };
  return obj.translation?.map((t) => t.text ?? "").filter(Boolean).join(" ") ?? "";
}

export async function fetchActiveAlerts(opts: {
  stopIds: string[];
  routeIds: string[] | null;
}): Promise<AlertRow[]> {
  const { stopIds, routeIds } = opts;
  const stopIdSet = new Set(stopIds);
  const feeds = [...new Set(stopIds.map(feedKeyForStopId))];
  const now = Date.now() / 1000;
  const rows: AlertRow[] = [];

  await Promise.all(
    feeds.map(async (feedKey) => {
      try {
        const res = await fetch(FEEDS[feedKey], { cache: "no-store" });
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buf));
        for (const entity of feed.entity) {
          const alert = entity.alert;
          if (!alert) continue;

          // Relevance: alert must touch THIS station's stops, or one of its lines.
          // "all" routes (routeIds null) still requires a stop/route link to the station.
          const informed = (alert.informedEntity ?? []) as Array<{ routeId?: string; stopId?: string }>;
          const alertRoutes = informed
            .map((i) => i.routeId)
            .filter((r): r is string => typeof r === "string" && r.length > 0);
          const alertStops = informed
            .map((i) => i.stopId)
            .filter((s): s is string => typeof s === "string" && s.length > 0);
          const touchesStationStop = alertStops.some((s) => stopIdSet.has(s));
          const matchesRequestedRoute =
            routeIds == null || routeIds.length === 0 || alertRoutes.some((r) => routeIds.includes(r));
          if (!touchesStationStop && !matchesRequestedRoute) {
            continue;
          }

          // Active window (start = earliest, end = latest when service resumes);
          // drop alerts that already concluded.
          let startSec: number | undefined;
          let resumeSec: number | undefined;
          const periods = alert.activePeriod as Array<{ start?: unknown; end?: unknown }> | undefined;
          for (const p of periods ?? []) {
            const s = protoSec(p.start);
            const e = protoSec(p.end);
            if (startSec == null || (s != null && s < startSec)) startSec = s;
            if (resumeSec == null || (e != null && e > resumeSec)) resumeSec = e;
          }
          if (resumeSec != null && resumeSec < now) continue;

          const header = transString(alert.headerText);
          if (!header) continue;
          rows.push({
            header,
            description: transString(alert.descriptionText) || undefined,
            startSec,
            endSec: resumeSec,
            resumeSec,
            cause: causeLabel((alert as { cause?: unknown }).cause),
            routes: alertRoutes,
          });
        }
      } catch {
        // Ignore a single feed failure; keep whatever else decoded.
      }
    }),
  );

  return rows;
}