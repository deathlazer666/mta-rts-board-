// Generates lib/data/bus-graph.json from the MTA static bus GTFS feeds
// (one feed per borough: gtfs_b, gtfs_bx, gtfs_m, gtfs_q, gtfs_si, gtfs_busco).
// For each bus route: the set of (stopA, stopB, direction) adjacency edges
// derived from real trip stop sequences, the most common trip headsign per
// direction, the route's long name, plus a stop table and transfer links
// between nearby subway stations and bus stops.
//
// Usage: bun run scripts/gen-bus-graph.ts /path/to/gtfs_bus/gtfs_b /path/to/gtfs_bus/gtfs_bx ...
import { readFileSync, writeFileSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

const FEED_DIRS = process.argv.slice(2);
if (FEED_DIRS.length === 0) {
  console.error("Usage: bun run scripts/gen-bus-graph.ts /path/to/gtfs_bus/gtfs_b ...");
  process.exit(1);
}

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

// --- helpers -----------------------------------------------------------------
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// --- subway stations (for transfer links) ------------------------------------
const subwayStations = JSON.parse(
  readFileSync(path.join(PROJECT_ROOT, "lib/data/stations.json"), "utf8"),
) as { id: string; name: string; lat: number; lon: number }[];

// --- accumulated data across feeds -------------------------------------------
const routeMeta = new Map<string, { name: string; shortName: string }>();
const stopMeta = new Map<string, { name: string; lat: number; lon: number }>();
const tripInfo = new Map<string, { route: string; dir: number; headsign: string }>();

type Acc = {
  edges: Map<string, { a: string; b: string; dir: number; count: number }>;
  headsigns: Map<string, Map<string, number>>;
  tripCount: number;
};
const acc = new Map<string, Acc>();

for (const dir of FEED_DIRS) {
  console.log(`processing ${path.basename(dir)} ...`);

  // routes.txt
  {
    const lines = readFileSync(path.join(dir, "routes.txt"), "utf8").trim().split("\n");
    const header = splitCsv(lines[0]);
    const iId = header.indexOf("route_id");
    const iShort = header.indexOf("route_short_name");
    const iLong = header.indexOf("route_long_name");
    for (let i = 1; i < lines.length; i++) {
      const c = splitCsv(lines[i]);
      const id = c[iId];
      if (!id) continue;
      if (!routeMeta.has(id)) {
        routeMeta.set(id, { name: c[iLong] ?? "", shortName: c[iShort] ?? id });
      }
    }
  }

  // stops.txt
  {
    const lines = readFileSync(path.join(dir, "stops.txt"), "utf8").trim().split("\n");
    const header = splitCsv(lines[0]);
    const iId = header.indexOf("stop_id");
    const iName = header.indexOf("stop_name");
    const iLat = header.indexOf("stop_lat");
    const iLon = header.indexOf("stop_lon");
    for (let i = 1; i < lines.length; i++) {
      const c = splitCsv(lines[i]);
      const id = c[iId];
      if (!id) continue;
      const lat = parseFloat(c[iLat]);
      const lon = parseFloat(c[iLon]);
      if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
      if (!stopMeta.has(id)) {
        stopMeta.set(id, { name: c[iName] ?? id, lat, lon });
      }
    }
  }

  // trips.txt
  {
    const lines = readFileSync(path.join(dir, "trips.txt"), "utf8").trim().split("\n");
    const header = lines[0].split(",");
    const iRoute = header.indexOf("route_id");
    const iTrip = header.indexOf("trip_id");
    const iDir = header.indexOf("direction_id");
    const iHead = header.indexOf("trip_headsign");
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const route = cols[iRoute];
      const trip = cols[iTrip];
      if (!route || !trip) continue;
      tripInfo.set(trip, {
        route,
        dir: cols[iDir] === "1" ? 1 : 0,
        headsign: cols[iHead] || "",
      });
    }
  }

  // stop_times.txt — streamed, grouped by trip (verified for these feeds)
  const finalize = (tripId: string, stops: { stopId: string; seq: number }[]) => {
    const info = tripInfo.get(tripId);
    if (!info || stops.length < 2) return;
    let a = acc.get(info.route);
    if (!a) {
      a = { edges: new Map(), headsigns: new Map(), tripCount: 0 };
      acc.set(info.route, a);
    }
    a.tripCount += 1;
    if (info.headsign) {
      const k = info.dir === 1 ? "1" : "0";
      let m = a.headsigns.get(k);
      if (!m) {
        m = new Map();
        a.headsigns.set(k, m);
      }
      m.set(info.headsign, (m.get(info.headsign) ?? 0) + 1);
    }
    stops.sort((x, y) => x.seq - y.seq);
    let prev: string | null = null;
    for (const { stopId } of stops) {
      if (stopId === prev) continue;
      if (prev !== null) {
        const key = [prev, stopId].sort().join("|");
        const e = a.edges.get(key);
        if (e) e.count += 1;
        else a.edges.set(key, { a: prev, b: stopId, dir: info.dir, count: 1 });
      }
      prev = stopId;
    }
  };

  {
    const rl = createInterface({ input: createReadStream(path.join(dir, "stop_times.txt")) });
    let first = true;
    let curTrip: string | null = null;
    let curStops: { stopId: string; seq: number }[] = [];
    for await (const line of rl) {
      if (first) {
        first = false;
        continue;
      }
      if (!line) continue;
      const [tripId, , , stopId, seqStr] = line.split(",");
      if (tripId !== curTrip) {
        if (curTrip) finalize(curTrip, curStops);
        curTrip = tripId;
        curStops = [];
      }
      curStops.push({ stopId, seq: Number(seqStr) });
    }
    if (curTrip) finalize(curTrip, curStops);
  }
}

// --- frequency filter + emit -------------------------------------------------
const MIN_SHARE = 0.05;
const MIN_COUNT = 3;

const routes: Record<string, { name: string; short: string; edges: [string, string, number][]; headsigns: (string | null)[] }> = {};
for (const [route, a] of acc) {
  const threshold = Math.max(MIN_COUNT, Math.ceil(a.tripCount * MIN_SHARE));
  const edges: [string, string, number][] = [];
  for (const e of a.edges.values()) {
    if (e.count < threshold) continue;
    // Emit both orientations with the correct direction_id for each traversal.
    edges.push([e.a, e.b, e.dir]);
    edges.push([e.b, e.a, e.dir === 1 ? 0 : 1]);
  }
  const headsigns: (string | null)[] = [null, null];
  for (const [dirStr, m] of a.headsigns) {
    headsigns[dirStr === "1" ? 1 : 0] = [...m.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
  }
  const meta = routeMeta.get(route);
  routes[route] = { name: meta?.name ?? "", short: meta?.shortName ?? route, edges, headsigns };
}

// --- subway <-> bus transfer links -------------------------------------------
const LINK_MAX_METERS = 150;
const links: [string, string][] = [];
for (const s of subwayStations) {
  const near: { stop: string; meters: number }[] = [];
  for (const [stopId, st] of stopMeta) {
    const m = haversineMeters(s.lat, s.lon, st.lat, st.lon);
    if (m <= LINK_MAX_METERS) near.push({ stop: stopId, meters: m });
  }
  near.sort((x, y) => x.meters - y.meters);
  // Cap at the 10 nearest stops per station to keep the graph lean.
  for (const n of near.slice(0, 10)) links.push([s.id, n.stop]);
}

// --- write -------------------------------------------------------------------
const stops: Record<string, [number, number, string]> = {};
for (const [id, s] of stopMeta) stops[id] = [s.lat, s.lon, s.name];

const outPath = path.join(PROJECT_ROOT, "lib/data/bus-graph.json");
writeFileSync(outPath, JSON.stringify({ routes, stops, links }, null, 0) + "\n");

const totalEdges = Object.values(routes).reduce((n, r) => n + r.edges.length, 0);
console.log(`routes: ${Object.keys(routes).length}, edges: ${totalEdges}, stops: ${Object.keys(stops).length}, links: ${links.length}`);
console.log(`written ${outPath} (${(require("node:fs").statSync(outPath).size / 1048576).toFixed(1)} MB)`);
