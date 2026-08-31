// Client-safe MTA service-status (service alert) fetcher.
//
// MTA publishes per-line subway service status via the ``Mercury`` extension of
// the GTFS-RT ``Alert`` message (see the OneBusAway copy of
// gtfs-realtime-service-status.proto). The bundled ``gtfs-realtime-bindings``
// decoder drops unknown extension fields, so we hand-decode just the bytes we
// need here: FeedMessage -> FeedEntity.alert -> Alert, plus the Mercury
// extension (field 1001) whose ``alert_type`` is the per-line status.
import { FEEDS, feedKeyForStopId } from "@/lib/arrivals";
import { ROUTE_ORDER } from "@/lib/routes";

export type LineStatusRow = {
  routeId: string;
  /** Human-friendly service status, e.g. "Good service", "Delays". */
  status: string;
  good: boolean;
  header?: string;
  description?: string;
  resumeSec?: number;
};

// ---------- minimal protobuf reader ----------

type Buf = { b: Uint8Array; p: number };

function readVarint(r: Buf): number {
  let res = 0;
  let shift = 0;
  for (let i = 0; i < 10; i++) {
    if (r.p >= r.b.length) break;
    const byte = r.b[r.p++];
    res += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return res;
    shift += 7;
  }
  return res;
}

function slice(r: Buf, len: number): Buf {
  const b = r.b.subarray(r.p, r.p + len);
  r.p += len;
  return { b, p: 0 };
}

// `r` is a length-delimited child buffer already stripped of its length prefix;
// decode its full contents as UTF-8.
function decodeString(r: Buf): string {
  return new TextDecoder().decode(r.b.subarray(r.p));
}

function skip(r: Buf, wire: number): void {
  if (wire === 0) readVarint(r);
  else if (wire === 1) r.p += 8;
  else if (wire === 2) r.p += readVarint(r);
  else if (wire === 5) r.p += 4;
  else r.p = r.b.length; // groups: bail on malformed
}

// Walk a message; for each field call cb(fieldNumber, value, wireType).
// wire 0 -> number (varint); wire 2 -> Buf (length-delimited).
function walk(r: Buf, cb: (field: number, v: number | Buf, wire: number) => void): void {
  while (r.p < r.b.length) {
    const tag = readVarint(r);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (wire === 0) cb(field, readVarint(r), 0);
    else if (wire === 2) {
      const len = readVarint(r);
      cb(field, slice(r, len), 2);
    } else skip(r, wire);
  }
}

// ---------- decoded messages ----------

type TimeRange = { start?: number; end?: number };

type EntitySel = { routeId?: string; stopId?: string };

type MercuryAlert = { alertType?: string };

type AlertMsg = {
  activePeriod: TimeRange[];
  informed: EntitySel[];
  cause?: number;
  header: string;
  description: string;
  mercury?: MercuryAlert;
};

// Translate.text = 1 (TranslatedString.translation = 1)
function readText(r: Buf): string {
  let text = "";
  walk(r, (f, v) => {
    if (f === 1 && typeof v === "object") text = decodeString(v);
  });
  return text;
}

function readStringMessage(r: Buf): string {
  let out = "";
  walk(r, (f, v) => {
    if (f === 1 && typeof v === "object") out += readText(v);
  });
  return out;
}

function readTimeRange(r: Buf): TimeRange {
  const tr: TimeRange = {};
  walk(r, (f, v) => {
    if (f === 1 && typeof v === "number") tr.start = v;
    else if (f === 2 && typeof v === "number") tr.end = v;
  });
  return tr;
}

// EntitySelector: routeId = 2, stopId = 5
function readEntity(r: Buf): EntitySel {
  const e: EntitySel = {};
  walk(r, (f, v) => {
    if (f === 2 && typeof v === "object") e.routeId = decodeString(v);
    else if (f === 5 && typeof v === "object") e.stopId = decodeString(v);
  });
  return e;
}

// MercuryAlert: alert_type = 3 (string), human_readable_active_period = 8,
// affected_stations = 10 (EntitySelector), screens_summary = 11.
function readMercury(r: Buf): MercuryAlert {
  const m: MercuryAlert = {};
  walk(r, (f, v) => {
    if (f === 3 && typeof v === "object") m.alertType = decodeString(v);
  });
  return m;
}

// Alert: active_period = 1, informed_entity = 5, cause = 6, header_text = 10,
// description_text = 11, mercury extension = 1001.
function readAlert(r: Buf): AlertMsg {
  const a: AlertMsg = { activePeriod: [], informed: [], header: "", description: "" };
  walk(r, (f, v) => {
    if (f === 1 && typeof v === "object") a.activePeriod.push(readTimeRange(v));
    else if (f === 5 && typeof v === "object") a.informed.push(readEntity(v));
    else if (f === 6 && typeof v === "number") a.cause = v;
    else if (f === 10 && typeof v === "object") a.header = readStringMessage(v);
    else if (f === 11 && typeof v === "object") a.description = readStringMessage(v);
    else if (f === 1001 && typeof v === "object") a.mercury = readMercury(v);
  });
  return a;
}

// FeedMessage.entity = 2; FeedEntity.alert = 5.
export function readFeed(buf: Uint8Array): AlertMsg[] {
  const root: Buf = { b: buf, p: 0 };
  const alerts: AlertMsg[] = [];
  walk(root, (f, v) => {
    if (f === 2 && typeof v === "object") {
      walk(v, (ff, vv) => {
        if (ff === 5 && typeof vv === "object") alerts.push(readAlert(vv));
      });
    }
  });
  return alerts;
}

// ---------- status label ----------

const STATUS_LABELS: Record<string, string> = {
  GOOD_SERVICE: "Good service",
  GOOD_SERVICES: "Good service",
  DELAY: "Delays",
  DELAYS: "Delays",
  SOME_DELAYS: "Some delays",
  EXPECT_DELAYS: "Expect delays",
  SEVERE_DELAYS: "Severe delays",
  PLANNED_WORK: "Planned work",
  SERVICE_CHANGE: "Service change",
  SPECIAL_SCHEDULE: "Special schedule",
  SPECIAL_NOTICE: "Special notice",
  SUSPENDED: "Suspended",
  CANCELLATIONS: "Cancellations",
  STOPS_SKIPPED: "Stops skipped",
  REROUTE: "Reroute",
  DETOUR: "Detour",
  SUBSTITUTE_BUSES: "Substitute buses",
  PART_SUSPENDED: "Part suspended",
};

function statusLabel(alertType?: string): { status: string; good: boolean } {
  if (!alertType) return { status: "Good service", good: true };
  const exact = STATUS_LABELS[alertType];
  const status =
    exact ??
    alertType
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  const good = /^GOOD|^NORMAL/.test(alertType) || exact === "Good service";
  return { status, good };
}

// ---------- public API ----------

function alertPast(activePeriod: TimeRange[], now: number): boolean {
  return (
    activePeriod.length > 0 && activePeriod.every((p) => p.end != null && p.end < now)
  );
}

function statusForAlert(al: AlertMsg): string {
  // Prefer the Mercury per-line status when present; otherwise surface the
  // alert header (a line with a service-change alert is never "good service").
  if (al.mercury?.alertType) return statusLabel(al.mercury.alertType).status;
  return al.header && al.header.trim() !== "" ? al.header : "Service change";
}

export async function fetchLineStatus(opts: {
  stopIds: string[];
  routeIds: string[] | null;
}): Promise<LineStatusRow[]> {
  const { stopIds, routeIds } = opts;
  const feeds = [...new Set(stopIds.map(feedKeyForStopId))];
  const now = Date.now() / 1000;

  // routeId -> all currently-active alerts that affect that line.
  const byRoute = new Map<string, AlertMsg[]>();

  await Promise.all(
    feeds.map(async (feedKey) => {
      try {
        const res = await fetch(FEEDS[feedKey], { cache: "no-store" });
        if (!res.ok) return;
        const alerts = readFeed(new Uint8Array(await res.arrayBuffer()));
        for (const al of alerts) {
          if (alertPast(al.activePeriod, now)) continue;
          const routes = al.informed
            .map((i) => i.routeId)
            .filter((r): r is string => typeof r === "string" && r.length > 0);
          const matched =
            routeIds && routeIds.length > 0
              ? routes.filter((r) => routeIds!.includes(r))
              : routes;
          for (const route of matched) {
            const list = byRoute.get(route) ?? [];
            list.push(al);
            byRoute.set(route, list);
          }
        }
      } catch {
        // Ignore a single feed failure; keep what decoded elsewhere.
      }
    }),
  );

  // Build one row per selected line. A line with ANY active alert is NOT good.
  const baseRoutes =
    routeIds && routeIds.length > 0 ? routeIds : [...byRoute.keys()];

  const rows = baseRoutes.map((routeId) => {
    const list = byRoute.get(routeId) ?? [];
    if (list.length === 0) {
      return { routeId, status: "Good service", good: true };
    }
    // Prefer an alert that carries a Mercury status label.
    const pick = list.find((a) => a.mercury?.alertType) ?? list[0];
    let resumeSec: number | undefined;
    for (const al of list) {
      for (const p of al.activePeriod) {
        if (p.end != null && p.end >= now && (resumeSec == null || p.end > resumeSec)) {
          resumeSec = p.end;
        }
      }
    }
    return {
      routeId,
      status: statusForAlert(pick),
      good: false,
      header: pick.header || undefined,
      description: pick.description || undefined,
      resumeSec,
    };
  });

  return rows.sort(
    (a, b) => ROUTE_ORDER.indexOf(a.routeId) - ROUTE_ORDER.indexOf(b.routeId),
  );
}