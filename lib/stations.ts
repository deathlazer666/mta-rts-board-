// Station list derived from real MTA GTFS static data.
// stations.json = all parent stations (location_type=1);
// platforms.json  = platform stop_id -> parent station id.
// Stations are grouped by name so complex/hub stations (e.g. Times Sq-42 St)
// surface every platform and therefore every train line that serves them.
import stationsData from "@/lib/data/stations.json";
import platformsData from "@/lib/data/platforms.json";

type StationRaw = { id: string; name: string; lat?: number; lon?: number };
const STATIONS_RAW = stationsData as StationRaw[];
const PLATFORMS = platformsData as Record<string, string>;

export type Station = {
  id: string; // representative GTFS parent station code
  name: string;
  stopIds: string[]; // platform stop_ids in the RT feeds (e.g. 127N, 127S, R16N, R16S)
  lat?: number;
  lon?: number;
};

const parentIdToName = new Map(STATIONS_RAW.map((s) => [s.id, s.name]));
const parentIdToLatLon = new Map(
  STATIONS_RAW.filter((s) => s.lat != null).map((s) => [s.id, { lat: s.lat!, lon: s.lon! }]),
);

const byName = new Map<string, { ids: string[]; stopIds: string[] }>();

for (const s of STATIONS_RAW) {
  const entry = byName.get(s.name) ?? { ids: [], stopIds: [] };
  entry.ids.push(s.id);
  byName.set(s.name, entry);
}

for (const [stopId, parentId] of Object.entries(PLATFORMS)) {
  const name = parentIdToName.get(parentId);
  if (!name) continue;
  const entry = byName.get(name) ?? { ids: [], stopIds: [] };
  entry.stopIds.push(stopId);
  byName.set(name, entry);
}

// Hubs that are physically one 24/7 transfer complex but are split across
// multiple GTFS parent stations. Selecting any member shows arrivals for EVERY
// line in the complex. The 42 St underground concourse connects Times Sq-42 St
// (7, N/Q/R/W), Port Authority Bus Terminal (A/C/E) and Bryant Park (7, B/D/F/M).
const COMPLEX_GROUPS: Record<string, string[]> = {
  "Times Sq-42 St": ["Times Sq-42 St", "42 St-Port Authority Bus Terminal", "42 St-Bryant Pk"],
  "42 St-Port Authority Bus Terminal": ["Times Sq-42 St", "42 St-Port Authority Bus Terminal", "42 St-Bryant Pk"],
  "42 St-Bryant Pk": ["Times Sq-42 St", "42 St-Port Authority Bus Terminal", "42 St-Bryant Pk"],
};

function complexStopIds(name: string): string[] | null {
  const group = COMPLEX_GROUPS[name];
  if (!group) return null;
  const members = group
    .map((memberName) => byName.get(memberName))
    .filter((m): m is { ids: string[]; stopIds: string[] } => !!m);
  return [...new Set(members.flatMap((m) => m.stopIds))];
}

export const STATIONS: Station[] = [...byName.entries()].map(([name, entry]) => {
  const mergedIds = [...new Set(entry.ids)];
  const mergedStopIds = complexStopIds(name) ?? [...new Set(entry.stopIds)];
  const representativeId = mergedIds.sort((a, b) => a.length - b.length)[0];
  const coords = parentIdToLatLon.get(mergedIds.find((id) => parentIdToLatLon.has(id)) ?? "");
  return {
    id: representativeId,
    name,
    stopIds: mergedStopIds.sort(
      // Keep numbered platforms first, then lettered; N before S within a station.
      (a, b) =>
        feedSortKey(a) - feedSortKey(b) ||
        a.localeCompare(b),
    ),
    ...(coords ?? {}),
  };
}).sort((a, b) => a.name.localeCompare(b.name));

export const DEFAULT_STATION_ID = STATIONS.find((s) => s.stopIds.length >= 6)?.id ?? STATIONS[0].id;

// Grouping key so numbered-line stations sort before lettered-line platforms.
function feedSortKey(stopId: string): number {
  return /^[0-9]/.test(stopId) ? 0 : 1;
}

// Station picker grouping: instead of one flat alphabetical list, the settings
// menu lists stations in optgroups, one per train set ("A C E", "1 2 3", ...).
// A hub like Times Sq-42 St appears under every line group that serves it.
// MTA GTFS stop ids embed the route prefix ("127N" = 1 train, "A27N" = A train,
// "H03N" = Rockaway branch (served by A), "S09N"+ = SIR, "S01N"-"S04N" = Franklin shuttle).
export const LINE_GROUPS = [
  "A C E",
  "B D F M",
  "N Q R W",
  "7",
  "1 2 3",
  "4 5 6",
  "L",
  "G",
  "J Z",
  "SIR",
] as const;

const SHUTTLE_GROUP = "Shuttles";

const PREFIX_TO_GROUP: Record<string, string> = {
  "1": "1 2 3", "2": "1 2 3", "3": "1 2 3",
  "4": "4 5 6", "5": "4 5 6", "6": "4 5 6",
  "7": "7",
  A: "A C E", C: "A C E", E: "A C E", H: "A C E", // H = Rockaway branch, A trains run there
  B: "B D F M", D: "B D F M", F: "B D F M", M: "B D F M",
  N: "N Q R W", Q: "N Q R W", R: "N Q R W", W: "N Q R W",
  L: "L", G: "G", J: "J Z", Z: "J Z",
};

// Map a platform stop id to its picker group (or null if unrecognized).
function groupForStopId(stopId: string): string | null {
  const m = stopId.match(/^([A-Z]|[1-9])(\d{2})[NS]$/);
  if (!m) return null;
  const prefix = m[1];
  const stationNum = Number(m[2]);
  // SIR platforms are S09+; S01-S04 are the Franklin Av shuttle.
  if (prefix === "S") return stationNum >= 9 ? "SIR" : SHUTTLE_GROUP;
  // "9" = 42 St shuttle platforms (901/902) under Grand Central / Times Sq.
  if (prefix === "9") return SHUTTLE_GROUP;
  return PREFIX_TO_GROUP[prefix] ?? null;
}

// All stations bucketed by line set, in the picker's display order.
export const STATION_GROUPS: { label: string; stations: Station[] }[] = (() => {
  const buckets = new Map<string, Station[]>();
  const add = (label: string, s: Station) => {
    const arr = buckets.get(label) ?? [];
    arr.push(s);
    buckets.set(label, arr);
  };
  for (const s of STATIONS) {
    const labels = new Set<string>();
    for (const stopId of s.stopIds) {
      const g = groupForStopId(stopId);
      if (g) labels.add(g);
    }
    if (labels.size === 0) labels.add(SHUTTLE_GROUP); // never drop a station
    for (const label of labels) add(label, s);
  }
  const order = [...LINE_GROUPS, SHUTTLE_GROUP];
  return order
    .map((label) => ({
      label,
      stations: (buckets.get(label) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.stations.length > 0);
})();

export function stationByStopId(stopId: string): Station | undefined {
  return STATIONS.find((s) => s.stopIds.includes(stopId));
}

export function stationById(id: string): Station | undefined {
  return STATIONS.find((s) => s.id === id);
}

// Resolve a platform stop_id (or parent id) to its human-readable station name.
export function stationNameForStopId(stopId: string): string | undefined {
  const parentId = PLATFORMS[stopId] ?? stopId;
  return parentIdToName.get(parentId);
}