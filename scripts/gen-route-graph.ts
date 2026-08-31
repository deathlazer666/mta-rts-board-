// Generates lib/data/route-graph.json from the MTA static GTFS feed:
// for each subway route, the set of (stationA, stationB, direction) adjacency
// edges derived from real trip stop sequences, plus the most common trip
// headsign for each direction. Used by the Directions tab to compute routes.
//
// Nodes are GTFS parent station ids (unique per physical station), NOT names,
// so stations that share a name but are physically different (e.g. the two
// "86 St"s) never collide. Edges are frequency-filtered: patterns used by only
// a tiny fraction of a route's trips (e.g. N trains diverted via 63 St) are
// dropped so they can't act as shortcuts.
//
// Usage: bun run scripts/gen-route-graph.ts /path/to/gtfs_static
import { readFileSync, writeFileSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

const FEED_DIR = process.argv[2];
if (!FEED_DIR) {
  console.error("Usage: bun run scripts/gen-route-graph.ts /path/to/gtfs_static");
  process.exit(1);
}

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

// platform stop_id -> parent station id (e.g. "101S" -> "101")
const platforms = JSON.parse(readFileSync(path.join(PROJECT_ROOT, "lib/data/platforms.json"), "utf8")) as Record<string, string>;
const stopIdToParent = new Map(Object.entries(platforms));

const SUBWAY_ROUTES = new Set([
  "1", "2", "3", "4", "5", "6", "6X", "7", "7X",
  "A", "B", "C", "D", "E", "F", "FX", "G", "GS", "FS", "H",
  "J", "L", "M", "N", "Q", "R", "W", "Z",
]);

// --- trips.txt: route_id -> { trip_id -> { direction_id, headsign } }
const tripInfo = new Map<string, { route: string; dir: number; headsign: string }>();
{
  const lines = readFileSync(path.join(FEED_DIR, "trips.txt"), "utf8").trim().split("\n");
  const header = lines[0].split(",");
  const iRoute = header.indexOf("route_id");
  const iTrip = header.indexOf("trip_id");
  const iDir = header.indexOf("direction_id");
  const iHead = header.indexOf("trip_headsign");
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const route = cols[iRoute];
    if (!SUBWAY_ROUTES.has(route)) continue;
    tripInfo.set(cols[iTrip], {
      route,
      dir: cols[iDir] === "1" ? 1 : 0,
      headsign: cols[iHead] || "",
    });
  }
}

// --- stop_times.txt: trip -> ordered stop ids (only for trips of interest)
const tripStops = new Map<string, { stopId: string; seq: number }[]>();
{
  const rl = createInterface({ input: createReadStream(path.join(FEED_DIR, "stop_times.txt")) });
  let first = true;
  for await (const line of rl) {
    if (first) {
      first = false;
      continue;
    }
    if (!line) continue;
    const [tripId, stopId, , , seqStr] = line.split(",");
    if (!tripInfo.has(tripId)) continue;
    let arr = tripStops.get(tripId);
    if (!arr) {
      arr = [];
      tripStops.set(tripId, arr);
    }
    arr.push({ stopId, seq: Number(seqStr) });
  }
}

// Edge counts per route: "a|b" -> trip count. Also collect headsign counts.
type Acc = {
  edges: Map<string, { a: string; b: string; dir: number; count: number }>;
  headsigns: Map<string, Map<string, number>>;
  tripCount: number;
};
const acc = new Map<string, Acc>();

for (const [tripId, info] of tripInfo) {
  const { route, dir, headsign } = info;
  const stops = (tripStops.get(tripId) ?? []).sort((a, b) => a.seq - b.seq);
  if (stops.length === 0) continue;

  let a = acc.get(route);
  if (!a) {
    a = { edges: new Map(), headsigns: new Map(), tripCount: 0 };
    acc.set(route, a);
  }
  a.tripCount += 1;
  if (headsign) {
    let m = a.headsigns.get(dir === 1 ? "1" : "0");
    if (!m) {
      m = new Map();
      a.headsigns.set(dir === 1 ? "1" : "0", m);
    }
    m.set(headsign, (m.get(headsign) ?? 0) + 1);
  }

  // Consecutive parent station ids along this trip, deduped.
  let prev: string | null = null;
  for (const { stopId } of stops) {
    const parent = stopIdToParent.get(stopId);
    if (!parent || parent === prev) continue;
    if (prev !== null) {
      const key = [prev, parent].sort().join("|");
      const e = a.edges.get(key);
      if (e) e.count += 1;
      else a.edges.set(key, { a: prev, b: parent, dir, count: 1 });
    }
    prev = parent;
  }
}

// Frequency filter: keep edges used by at least 5% of the route's trips (and
// at least 3 trips). Real branches (e.g. A to Far Rockaway vs Lefferts) pass;
// rare diversions (N via 63 St) are dropped.
const MIN_SHARE = 0.05;
const MIN_COUNT = 3;

const routes: Record<string, { edges: [string, string, number][]; headsigns: (string | null)[] }> = {};
for (const [route, a] of acc) {
  const threshold = Math.max(MIN_COUNT, Math.ceil(a.tripCount * MIN_SHARE));
  const edges: [string, string, number][] = [];
  for (const e of a.edges.values()) {
    if (e.count < threshold) continue;
    // Emit BOTH orientations: `dir` is the direction_id of the trip that
    // traversed a->b; the reverse traversal b->a runs with the opposite
    // direction_id (subway lines are bidirectional with consistent numbering).
    edges.push([e.a, e.b, e.dir]);
    edges.push([e.b, e.a, e.dir === 1 ? 0 : 1]);
  }
  const headsigns: (string | null)[] = [null, null];
  for (const [dirStr, m] of a.headsigns) {
    headsigns[dirStr === "1" ? 1 : 0] = [...m.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
  }
  routes[route] = { edges, headsigns };
}

const outPath = path.join(PROJECT_ROOT, "lib/data/route-graph.json");
writeFileSync(outPath, JSON.stringify({ routes }, null, 0) + "\n");
const totalEdges = Object.values(routes).reduce((n, r) => n + r.edges.length, 0);
console.log(`routes: ${Object.keys(routes).length}, edges: ${totalEdges}`);
for (const [route, r] of Object.entries(routes)) {
  console.log(`  ${route}: ${r.edges.length} edges, headsigns [${r.headsigns.join(" | ")}]`);
}
