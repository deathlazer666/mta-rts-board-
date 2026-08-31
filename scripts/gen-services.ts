// Generator: builds lib/data/services.json from MTA GTFS static CSVs.
// For each route it records which service-day types it operates (weekday,
// Saturday, Sunday), derived from calendar.txt + calendar_dates.txt exceptions
// over the tail of the feed's service window.
// Usage: bun run scripts/gen-services.ts /tmp/gtfs_static
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";

const dir = process.argv[2] ?? "/tmp/gtfs_static";
if (!existsSync(`${dir}/calendar.txt`)) {
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
      else if (c === ",") { out.push(cur); cur = ""; }
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

// GTFS weekday numbers: 1 = Monday ... 7 = Sunday. JS getUTCDay(): 0 = Sunday.
const GTFS_DAY_TO_INDEX: Record<string, number> = {
  "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "0": 0,
};

function parseDate(yyyymmdd: string): Date {
  return new Date(Date.UTC(
    Number(yyyymmdd.slice(0, 4)),
    Number(yyyymmdd.slice(4, 6)) - 1,
    Number(yyyymmdd.slice(6, 8)),
  ));
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

const calendar = parseCsv(readFileSync(`${dir}/calendar.txt`, "utf8"));
const calendarDates = parseCsv(readFileSync(`${dir}/calendar_dates.txt`, "utf8"));
const trips = parseCsv(readFileSync(`${dir}/trips.txt`, "utf8"));

// service_id -> base day activity (index 0..6) + start/end dates
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const svcBase = new Map<string, { days: boolean[]; end: number }>();
for (const row of calendar) {
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => row[WEEKDAY_NAMES[i]] === "1");
  svcBase.set(row.service_id, { days, end: Date.parse(`${row.end_date}T00:00:00Z`) });
}

// exceptions: service_id -> { dateKey -> 1 (added) | 2 (removed) }
const exceptions = new Map<string, Map<string, number>>();
for (const row of calendarDates) {
  let m = exceptions.get(row.service_id);
  if (!m) { m = new Map(); exceptions.set(row.service_id, m); }
  m.set(row.date, Number(row.exception_type));
}

// Effective activity per service over the last 28 days of its window.
function effectiveDays(serviceId: string): boolean[] {
  const base = svcBase.get(serviceId);
  const result = base ? [...base.days] : [false, false, false, false, false, false, false];
  const end = base ? base.end : Date.now();
  const exc = exceptions.get(serviceId);
  if (!exc) return result;
  const start = end - 27 * 86400000;
  for (let t = start; t <= end; t += 86400000) {
    const d = new Date(t);
    const k = dateKey(d);
    const type = exc.get(k);
    if (type === 1) result[d.getUTCDay()] = true;
    else if (type === 2) result[d.getUTCDay()] = false;
  }
  return result;
}

// route_id -> set of service_ids
const routeServices = new Map<string, Set<string>>();
for (const t of trips) {
  let set = routeServices.get(t.route_id);
  if (!set) { set = new Set(); routeServices.set(t.route_id, set); }
  set.add(t.service_id);
}

const services: Record<string, { weekday: boolean; saturday: boolean; sunday: boolean }> = {};
for (const [routeId, svcIds] of routeServices) {
  const any = [false, false, false, false, false, false, false];
  for (const sid of svcIds) {
    const eff = effectiveDays(sid);
    for (let i = 0; i < 7; i++) any[i] = any[i] || eff[i];
  }
  services[routeId] = {
    weekday: any[1] || any[2] || any[3] || any[4] || any[5], // Mon-Fri
    saturday: any[6],
    sunday: any[0],
  };
}

mkdirSync("lib/data", { recursive: true });
writeFileSync("lib/data/services.json", JSON.stringify(services, null, 1));
console.log(`services: ${Object.keys(services).length} routes`);
for (const r of Object.keys(services).sort()) {
  console.log(`${r}: ${JSON.stringify(services[r])}`);
}
