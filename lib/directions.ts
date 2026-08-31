// Multi-modal directions router (subway + bus).
//
// Nodes are GTFS station ids (unique per physical station), NOT names, so
// stations that share a name but are physically different (e.g. the two
// "86 St"s) never collide. Subway edges come from route-graph.json (real trip
// stop sequences from the MTA subway feed); bus edges come from bus-graph.json
// (MTA bus feeds). Bus stops that sit within ~150 m of a subway station are
// MERGED into that station node (a free transfer), while other bus stops are
// their own nodes. Dijkstra over (node, line) states produces the best route;
// legs are turned into human-readable directions.
import routeGraphData from "@/lib/data/route-graph.json";
import busGraphData from "@/lib/data/bus-graph.json";
import stationsData from "@/lib/data/stations.json";

type RouteGraph = {
  routes: Record<string, { edges: [string, string, number][]; headsigns: (string | null)[] }>;
};
type BusGraph = {
  routes: Record<string, { name: string; short: string; edges: [string, string, number][]; headsigns: (string | null)[] }>;
  stops: Record<string, [number, number, string]>;
  links: [string, string][]; // [subwayStationId, busStopId]
};
const GRAPH = routeGraphData as unknown as RouteGraph;
const BUS = busGraphData as unknown as BusGraph;
const STATION_ROWS = stationsData as { id: string; name: string; lat?: number; lon?: number }[];

export type GeoPoint = { lat: number; lon: number };

export type DirectionLeg = {
  line: string;
  mode: "subway" | "bus";
  routeName: string; // long name (e.g. "Ridgewood - Downtown Brooklyn")
  shortName: string; // badge (e.g. "B38", "Bx12-SBS")
  from: string; // display name
  to: string; // display name
  headsign: string | null;
  hops: number; // station-to-station rides in this leg
  stops: string[]; // every stop this trip makes, board ... get-off
};

export type RouteResult = {
  startStation: string;
  endStation: string;
  walkFromMeters: number;
  walkToMeters: number;
  legs: DirectionLeg[];
  transfers: number;
  stops: number;
};

const TRANSFER_PENALTY = 7; // cost of changing lines (walking + wait) at a station

// Average travel time per hop, used as the edge weight so the router compares
// real trip time rather than raw stop counts (bus stops are much denser than
// subway stations, so raw counts would make long bus chains look too good).
const SUBWAY_EDGE_MIN = 1.5;
const BUS_EDGE_MIN = 3;

const SUBWAY_LINES = new Set(Object.keys(GRAPH.routes));

// Physically connected transfer complexes that are split across multiple GTFS
// parent stations. The 42 St concourse connects the Times Sq, Port Authority
// (A/C/E) and Bryant Pk (B/D/F/M) parent stations; Grand Central, Penn Station
// and the other complexes below are likewise one physical station with several
// parent ids. Same-name stations that are NOT connected (the two "86 St"s,
// the two "Grand St"s) are deliberately absent.
const COMPLEXES: string[][] = [
  ["Times Sq-42 St", "42 St-Port Authority Bus Terminal", "42 St-Bryant Pk"],
  ["Grand Central-42 St"],
  ["34 St-Penn Station"],
  ["14 St-Union Sq"],
  ["Atlantic Av-Barclays Ctr"],
  ["Fulton St"],
  ["Jay St-MetroTech"],
  ["Borough Hall"],
  ["Court Sq"],
  ["W 4 St-Wash Sq"],
  ["59 St-Columbus Circle"],
  ["34 St-Herald Sq"],
  ["Delancey St-Essex St"],
  ["8 Av"],
  ["Broadway Junction"],
  ["Queensboro Plaza"],
  ["155 St"],
  ["161 St-Yankee Stadium"],
];

// Every parent station id that belongs to a transfer complex maps to that
// complex's canonical (representative) id, so all its lines share one node.
const nodeCanonical = new Map<string, string>();
for (const names of COMPLEXES) {
  const ids: string[] = [];
  for (const s of STATION_ROWS) {
    if (names.includes(s.name as (typeof COMPLEXES)[number][number])) ids.push(s.id);
  }
  if (ids.length < 2) continue;
  const canon = [...ids].sort((a, b) => a.length - b.length)[0];
  for (const id of ids) nodeCanonical.set(id, canon);
}

function subwayNodeKey(id: string): string {
  return nodeCanonical.get(id) ?? id;
}

// Bus stops within transfer range of a subway station merge into that node.
const busStopToSubway = new Map<string, string>();
for (const [subwayId, stopId] of BUS.links) busStopToSubway.set(stopId, subwayId);

function busNodeKey(stopId: string): string {
  const sub = busStopToSubway.get(stopId);
  return sub ? subwayNodeKey(sub) : `b:${stopId}`;
}

// ---- Graph ------------------------------------------------------------------
const stationByNode = new Map<string, { id: string; name: string; lat: number; lon: number }>();
const nodeName = new Map<string, string>(); // node -> display name (station or bus stop)
for (const s of STATION_ROWS) {
  if (s.lat == null || s.lon == null) continue;
  const k = subwayNodeKey(s.id);
  if (!stationByNode.has(k)) {
    stationByNode.set(k, { id: k, name: s.name, lat: s.lat, lon: s.lon });
    nodeName.set(k, s.name);
  }
}
for (const [stopId, [lat, lon, name]] of Object.entries(BUS.stops)) {
  const k = busNodeKey(stopId);
  if (!stationByNode.has(k)) {
    stationByNode.set(k, { id: k, name, lat, lon });
    nodeName.set(k, titleCase(name));
  }
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\b(St|Ave|Av|Blvd|Rd|Pkwy|Hwy|E|W|N|S|NE|NW|SE|SW)\b/gi, (w) => w.toUpperCase());
}

type Adj = Map<string, { nb: string; dir: number }[]>; // per route
const adjByRoute = new Map<string, Adj>();
const linesAtNode = new Map<string, Set<string>>();

function addEdge(route: string, a: string, b: string, dir: number) {
  const adj = adjByRoute.get(route) ?? new Map<string, { nb: string; dir: number }[]>();
  if (!adj.has(a)) adj.set(a, []);
  adj.get(a)!.push({ nb: b, dir });
  adjByRoute.set(route, adj);
  if (!linesAtNode.has(a)) linesAtNode.set(a, new Set());
  if (!linesAtNode.has(b)) linesAtNode.set(b, new Set());
  linesAtNode.get(a)!.add(route);
  linesAtNode.get(b)!.add(route);
}

for (const [route, data] of Object.entries(GRAPH.routes)) {
  for (const [a, b, dir] of data.edges) {
    const na = subwayNodeKey(a);
    const nb = subwayNodeKey(b);
    if (!stationByNode.has(na) || !stationByNode.has(nb)) continue;
    addEdge(route, na, nb, dir);
  }
}
for (const [route, data] of Object.entries(BUS.routes)) {
  for (const [a, b, dir] of data.edges) {
    const na = busNodeKey(a);
    const nb = busNodeKey(b);
    if (!stationByNode.has(na) || !stationByNode.has(nb)) continue;
    addEdge(route, na, nb, dir);
  }
}

// ---- Nearest station/stop ----------------------------------------------------
function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Candidate endpoints: the nearest few subway stations AND the nearest few bus
// stops, kept as separate pools so dense bus stops can't crowd out the subway
// stations (e.g. at JFK, where airport bus stops sit beside the terminals but
// the A train is 1.4 km away).
export function nearestStations(point: GeoPoint, k = 4): { id: string; name: string; meters: number }[] {
  const ranked = [...stationByNode.values()]
    .map((s) => ({ id: s.id, name: s.name, meters: haversineMeters(point, s) }))
    .sort((a, b) => a.meters - b.meters);
  const subways = ranked.filter((s) => !s.id.startsWith("b:")).slice(0, 3);
  const buses = ranked.filter((s) => s.id.startsWith("b:")).slice(0, 2);
  return [...subways, ...buses].slice(0, k);
}

// ---- Dijkstra over (station, line) states -----------------------------------
type State = { node: string; line: string | null; dir: number; cost: number; prev: State | null };

export function dijkstra(startNode: string, goalNode: string): State | null {
  const key = (node: string, line: string | null) => `${node}::${line ?? ""}`;
  const best = new Map<string, number>();

  // A* priority: cost + a lower bound on the remaining time to the goal
  // (straight-line distance at ~1 km/min — every hop costs >= 1.5 min and hops
  // are >= ~0.5 km, so this bound never overestimates).
  const goal = stationByNode.get(goalNode);
  const h = (node: string): number => {
    const n = stationByNode.get(node);
    if (!goal || !n) return 0;
    return haversineMeters(n, goal) / 600;
  };
  const queue: { state: State; prio: number }[] = [];
  const push = (s: State) => {
    queue.push({ state: s, prio: s.cost + h(s.node) });
    let i = queue.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (queue[p].prio <= queue[i].prio) break;
      [queue[p], queue[i]] = [queue[i], queue[p]];
      i = p;
    }
  };
  const pop = (): State | undefined => {
    const top = queue[0]?.state;
    const last = queue.pop();
    if (queue.length > 0 && last) {
      queue[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < queue.length && queue[l].prio < queue[m].prio) m = l;
        if (r < queue.length && queue[r].prio < queue[m].prio) m = r;
        if (m === i) break;
        [queue[m], queue[i]] = [queue[i], queue[m]];
        i = m;
      }
    }
    return top;
  };

  const startLines = linesAtNode.get(startNode);
  if (!startLines) return null;

  push({ node: startNode, line: null, dir: 0, cost: 0, prev: null });
  best.set(key(startNode, null), 0);

  while (queue.length > 0) {
    const st = pop()!;
    if (st.node === goalNode) return st;
    const k = key(st.node, st.line);
    if ((best.get(k) ?? Infinity) < st.cost) continue;

    const relax = (next: State) => {
      const nk = key(next.node, next.line);
      if (next.cost < (best.get(nk) ?? Infinity)) {
        best.set(nk, next.cost);
        push(next);
      }
    };

    if (st.line) {
      const adj = adjByRoute.get(st.line);
      const edgeMin = SUBWAY_LINES.has(st.line) ? SUBWAY_EDGE_MIN : BUS_EDGE_MIN;
      for (const { nb, dir } of adj?.get(st.node) ?? []) {
        relax({ node: nb, line: st.line, dir, cost: st.cost + edgeMin, prev: st });
      }
    }
    for (const line of linesAtNode.get(st.node) ?? []) {
      if (line === st.line) continue;
      relax({
        node: st.node,
        line,
        dir: 0,
        cost: st.cost + (st.line === null ? 0 : TRANSFER_PENALTY),
        prev: st,
      });
    }
  }
  return null;
}

export function statePath(goal: State): State[] {
  const path: State[] = [];
  for (let s: State | null = goal; s; s = s.prev) path.push(s);
  return path.reverse();
}

function toLegs(path: State[]): DirectionLeg[] {
  const legs: DirectionLeg[] = [];
  for (let i = 0; i < path.length; i++) {
    const st = path[i];
    if (!st.line) continue; // boarding state
    const nm = nodeName.get(st.node) ?? st.node;
    const isBus = !SUBWAY_LINES.has(st.line);
    const last = legs[legs.length - 1];
    if (!last || last.line !== st.line) {
      // Direction of the first hop: the state after this boarding state.
      const dir = path[i + 1]?.dir ?? st.dir;
      const busMeta = BUS.routes[st.line];
      legs.push({
        line: st.line,
        mode: isBus ? "bus" : "subway",
        routeName: isBus ? busMeta?.name ?? "" : "",
        shortName: isBus ? busMeta?.short ?? st.line : "",
        from: nm,
        to: nm,
        stops: [nm],
        headsign: (isBus ? busMeta?.headsigns : GRAPH.routes[st.line]?.headsigns)?.[dir] ?? null,
        hops: 0,
      });
    } else {
      last.to = nm;
      last.stops.push(nm);
      last.hops += 1;
    }
  }
  return legs;
}

// ---- Public API -------------------------------------------------------------
export function planRoute(origin: GeoPoint, dest: GeoPoint): RouteResult {
  const origins = nearestStations(origin, 4);
  const dests = nearestStations(dest, 4);

  if (origins[0].id === dests[0].id || haversineMeters(origin, dest) < 700) {
    return {
      startStation: origins[0].name,
      endStation: dests[0].name,
      walkFromMeters: origins[0].meters,
      walkToMeters: dests[0].meters,
      legs: [],
      transfers: 0,
      stops: 0,
    };
  }

  let best: { cost: number; path: State[]; o: (typeof origins)[number]; d: (typeof dests)[number] } | null = null;
  // Price the walk to/from the endpoint stops (~80 m/min) into the comparison,
  // so a marginally cheaper ride never wins at the cost of a much longer walk.
  const walkMin = (m: number) => m / 80;
  for (const o of origins) {
    for (const d of dests) {
      if (o.id === d.id) continue;
      const res = dijkstra(o.id, d.id);
      if (!res) continue;
      const path = statePath(res);
      const total = res.cost + walkMin(o.meters) + walkMin(d.meters);
      if (!best || total < best.cost) {
        best = { cost: total, path, o, d };
      }
    }
  }
  if (!best) {
    throw new Error("No route found between those addresses.");
  }

  const legs = toLegs(best.path);
  return {
    startStation: best.o.name,
    endStation: best.d.name,
    walkFromMeters: best.o.meters,
    walkToMeters: best.d.meters,
    legs,
    transfers: Math.max(0, legs.length - 1),
    stops: legs.reduce((n, l) => n + l.hops, 0),
  };
}

export function routeLineIcon(routeId: string): string {
  const overrides: Record<string, string> = {
    S: "s", GS: "s", FS: "s", H: "s", SF: "s", SR: "s", SIR: "sir",
    "7X": "7x", "7x": "7x", "6X": "6", "FX": "f",
  };
  return `${overrides[routeId] ?? routeId.toLowerCase()}.svg`;
}
