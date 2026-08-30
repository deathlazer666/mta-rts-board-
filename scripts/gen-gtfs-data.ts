// One-time generator: builds lib/data/*.json from MTA GTFS static CSVs.
// Usage: bun run scripts/gen-gtfs-data.ts /tmp/gtfs_static
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";

const dir = process.argv[2] ?? "/tmp/gtfs_static";
if (!existsSync(`${dir}/stops.txt`)) {
  console.error(`GTFS static dir not found at ${dir} — download https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip and unzip first`);
  process.exit(1);
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = vals[i] ?? ""));
    return row;
  });
}

mkdirSync("lib/data", { recursive: true });

// Routes: id, name, color, textColor
const routes = parseCsv(readFileSync(`${dir}/routes.txt`, "utf8"));
const routesOut = routes.map((r) => ({
  id: r.route_id,
  name: r.route_long_name,
  color: r.route_color ? `#${r.route_color}` : "#808183",
  textColor: r.route_text_color ? `#${r.route_text_color}` : "#FFFFFF",
}));
writeFileSync("lib/data/routes.json", JSON.stringify(routesOut, null, 1));
console.log(`routes: ${routesOut.length}`);

// Stations: parent stations only (location_type=1), grouped platforms
const stops = parseCsv(readFileSync(`${dir}/stops.txt`, "utf8"));
const parents = stops.filter((s) => s.location_type === "1");
const stationsOut = parents.map((s) => ({
  id: s.stop_id,
  name: s.stop_name,
  lat: parseFloat(s.stop_lat),
  lon: parseFloat(s.stop_lon),
}));
writeFileSync("lib/data/stations.json", JSON.stringify(stationsOut, null, 1));
console.log(`stations: ${stationsOut.length}`);

// Platforms: child stops -> parent mapping (stop_id -> parent_station)
const platforms: Record<string, string> = {};
for (const s of stops) {
  if (s.location_type !== "1" && s.parent_station) platforms[s.stop_id] = s.parent_station;
}
writeFileSync("lib/data/platforms.json", JSON.stringify(platforms));
console.log(`platforms: ${Object.keys(platforms).length}`);

// Headsigns: trip_id -> trip_headsign (first occurrence wins)
const trips = parseCsv(readFileSync(`${dir}/trips.txt`, "utf8"));
const headsigns: Record<string, string> = {};
for (const t of trips) {
  if (t.trip_headsign && !headsigns[t.trip_id]) headsigns[t.trip_id] = t.trip_headsign;
}
writeFileSync("lib/data/headsigns.json", JSON.stringify(headsigns));
console.log(`headsigns: ${Object.keys(headsigns).length}`);
