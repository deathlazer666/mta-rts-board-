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