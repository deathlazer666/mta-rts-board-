// Client-safe GTFS-RT arrival logic. Fetches the MTA protobuf trip-update feeds,
// decodes them, filters by stop ids + time horizon, and resolves each arrival to a
// real terminus destination and direction. Works in the browser (bundled) and in
// Node (the /api/arrivals route), so the app is self-contained inside an APK.
import * as GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { stationNameForStopId } from "@/lib/stations";

// MTA feed groupings (no API key needed since 2025).
export const FEEDS: Record<string, string> = {
  ace: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace",
  bdfm: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm",
  g: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g",
  jz: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz",
  nqrw: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw",
  l: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l",
  numbered: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
  si: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si",
};

export type ArrivalRow = {
  routeId: string;
  direction: "N" | "S";
  headsign: string;
  arrivalEpochSec: number;
  stopId: string;
  feedKey: string;
};

export function feedKeyForStopId(stopId: string): string {
  if (/^SIR/.test(stopId)) return "si";
  if (/^[1-7]/.test(stopId)) return "numbered";
  if (/^[ACEH]/.test(stopId)) return "ace";
  if (/^[BDFM]/.test(stopId)) return "bdfm";
  if (/^G/.test(stopId)) return "g";
  if (/^[JZ]/.test(stopId)) return "jz";
  if (/^[NQRW]/.test(stopId)) return "nqrw";
  if (/^L/.test(stopId)) return "l";
  return "numbered";
}

function protoTime(t: unknown): number | undefined {
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

export async function fetchArrivals(opts: {
  stopIds: string[];
  minutes: number;
}): Promise<{ arrivals: ArrivalRow[]; errors: string[] }> {
  const { stopIds, minutes } = opts;
  const feedsNeeded = [...new Set(stopIds.map(feedKeyForStopId))];
  const cutoff = Date.now() / 1000;
  const horizon = cutoff + minutes * 60;

  const arrivals: ArrivalRow[] = [];
  const errors: string[] = [];

  await Promise.all(
    feedsNeeded.map(async (feedKey) => {
      try {
        const res = await fetch(FEEDS[feedKey], { cache: "no-store" });
        if (!res.ok) throw new Error(`feed ${feedKey} HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buf));
        for (const entity of feed.entity) {
          const tu = entity.tripUpdate;
          if (!tu?.stopTimeUpdate) continue;
          const routeId = tu.trip?.routeId ?? "";
          const tripId = tu.trip?.tripId ?? "";
          const tripHeadsign = (tu.trip as { tripHeadsign?: string } | null | undefined)?.tripHeadsign ?? "";
          // Terminus = LAST stop-time update; resolve to a readable station name.
          const lastStopId = tu.stopTimeUpdate[tu.stopTimeUpdate.length - 1]?.stopId ?? "";
          const terminusName = stationNameForStopId(lastStopId);
          const headsign = tripHeadsign !== ""
            ? tripHeadsign
            : (terminusName ?? (lastStopId !== "" ? lastStopId : routeId));
          for (const stu of tu.stopTimeUpdate) {
            if (!stu.stopId || !stopIds.includes(stu.stopId)) continue;
            // Direction: MTA platform stop-ids carry an N/S suffix (authoritative).
            const suffix = stu.stopId.slice(-1);
            const direction = (suffix === "S" ? "S" : suffix === "N" ? "N" : tu.trip?.directionId === "1" ? "S" : "N") as "N" | "S";
            const when = protoTime(stu.arrival?.time ?? stu.departure?.time);
            if (!when || when < cutoff || when > horizon) continue;
            arrivals.push({
              routeId,
              direction,
              headsign,
              arrivalEpochSec: when,
              stopId: stu.stopId,
              feedKey,
            });
          }
        }
      } catch (e) {
        errors.push(`${feedKey}: ${(e as Error).message}`);
      }
    }),
  );

  arrivals.sort((a, b) => a.arrivalEpochSec - b.arrivalEpochSec);
  return { arrivals, errors };
}