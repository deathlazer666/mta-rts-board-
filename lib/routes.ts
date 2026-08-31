// MTA subway route metadata (colors + names), mirroring the official line colors.
import servicesData from "@/lib/data/services.json";

// Days each route operates, from the MTA static GTFS feed's service calendar
// (see scripts/gen-services.ts). Used to decide whether weekend rules apply.
const SERVICES = servicesData as Record<string, { weekday: boolean; saturday: boolean; sunday: boolean }>;

export type RouteInfo = {
  id: string;
  name: string;
  color: string; // bullet background
  textColor: string; // text on the bullet
};

export const ROUTES: Record<string, RouteInfo> = {
  "1": { id: "1", name: "Broadway - 7 Avenue Local", color: "#EE352E", textColor: "#FFFFFF" },
  "2": { id: "2", name: "7 Avenue Express", color: "#EE352E", textColor: "#FFFFFF" },
  "3": { id: "3", name: "7 Avenue Express", color: "#EE352E", textColor: "#FFFFFF" },
  "4": { id: "4", name: "Lexington Avenue Express", color: "#00933C", textColor: "#FFFFFF" },
  "5": { id: "5", name: "Lexington Avenue Express", color: "#00933C", textColor: "#FFFFFF" },
  "6": { id: "6", name: "Lexington Avenue Local", color: "#00933C", textColor: "#FFFFFF" },
  "6X": { id: "6X", name: "Pelham Bay Park Express", color: "#00933C", textColor: "#FFFFFF" },
  "7": { id: "7", name: "Flushing Local", color: "#B933AD", textColor: "#FFFFFF" },
  "7X": { id: "7X", name: "Flushing Express", color: "#B933AD", textColor: "#FFFFFF" },
  A: { id: "A", name: "8 Avenue Express", color: "#0039A6", textColor: "#FFFFFF" },
  C: { id: "C", name: "8 Avenue Local", color: "#0039A6", textColor: "#FFFFFF" },
  E: { id: "E", name: "8 Avenue Local", color: "#0039A6", textColor: "#FFFFFF" },
  B: { id: "B", name: "6 Avenue Express", color: "#FF6319", textColor: "#FFFFFF" },
  D: { id: "D", name: "6 Avenue Express", color: "#FF6319", textColor: "#FFFFFF" },
  F: { id: "F", name: "6 Avenue Local", color: "#FF6319", textColor: "#FFFFFF" },
  FX: { id: "FX", name: "Brooklyn F Express", color: "#FF6319", textColor: "#FFFFFF" },
  M: { id: "M", name: "6 Avenue Local", color: "#FF6319", textColor: "#FFFFFF" },
  G: { id: "G", name: "Brooklyn-Queens Crosstown", color: "#6CBE45", textColor: "#FFFFFF" },
  J: { id: "J", name: "Nassau Street Express", color: "#996633", textColor: "#FFFFFF" },
  Z: { id: "Z", name: "Nassau Street Express", color: "#996633", textColor: "#FFFFFF" },
  L: { id: "L", name: "Canarsie Local", color: "#A7A9AC", textColor: "#FFFFFF" },
  N: { id: "N", name: "Broadway Express", color: "#FCCC0A", textColor: "#000000" },
  Q: { id: "Q", name: "Broadway Express", color: "#FCCC0A", textColor: "#000000" },
  R: { id: "R", name: "Broadway Local", color: "#FCCC0A", textColor: "#000000" },
  W: { id: "W", name: "Broadway Local", color: "#FCCC0A", textColor: "#000000" },
  S: { id: "S", name: "Shuttle", color: "#808183", textColor: "#FFFFFF" },
  GS: { id: "GS", name: "Grand Central Shuttle", color: "#808183", textColor: "#FFFFFF" },
  FS: { id: "FS", name: "Franklin Av Shuttle", color: "#808183", textColor: "#FFFFFF" },
  H: { id: "H", name: "Rockaway Park Shuttle", color: "#808183", textColor: "#FFFFFF" },
  SF: { id: "SF", name: "Franklin Av Shuttle", color: "#808183", textColor: "#FFFFFF" },
  SR: { id: "SR", name: "Rockaway Park Shuttle", color: "#808183", textColor: "#FFFFFF" },
  SIR: { id: "SIR", name: "Staten Island Railway", color: "#0039A6", textColor: "#FFFFFF" },
};

// Base (weekday daytime) service type per line, per the real-world MTA network.
const DAY_DESIGNATION: Record<string, "Local" | "Express"> = {
  "1": "Local", "2": "Express", "3": "Express",
  "4": "Express", "5": "Express", "6": "Local", "6X": "Express",
  "7": "Local", "7X": "Express",
  A: "Express", C: "Local", E: "Local",
  B: "Express", D: "Express", F: "Local", FX: "Express", M: "Local", G: "Local",
  J: "Local", Z: "Express", L: "Local",
  N: "Express", Q: "Express", R: "Local", W: "Local",
  S: "Local", GS: "Local", FS: "Local", SF: "Local", SR: "Local", H: "Local", SIR: "Local",
};

// Express lines that switch to LOCAL during late-night service (~12am-6am NY time).
const NIGHT_LOCAL = new Set(["2", "3", "4", "5", "A", "D", "N", "Q"]);
// Lines that run LOCAL on weekends (MTA schedule), when the route runs weekends.
const WEEKEND_LOCAL = new Set(["N"]); // N runs local except weekday rush in the peak direction

type NyContext = { isWeekend: boolean; isNight: boolean };

// Day-of-week + hour in New York, regardless of the device's timezone.
function nycContext(nowMs: number): NyContext {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const dayStr = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const isWeekend = dayStr === "Sat" || dayStr === "Sun";
  return { isWeekend, isNight: hour < 6 };
}

// Local vs Express for a line, accounting for the MTA's weekday/weeknight and
// weekend schedules (based on the static GTFS service calendar + published
// service patterns). Pass the current time so the badge reflects the service
// actually running right now.
export function lineDesignation(id: string, nowMs?: number): "Local" | "Express" | undefined {
  const base = DAY_DESIGNATION[id];
  if (!base) return undefined;
  const { isWeekend, isNight } = nycContext(nowMs ?? Date.now());
  if (isNight && NIGHT_LOCAL.has(id)) return "Local";
  const svc = SERVICES[id];
  const runsWeekend = svc ? svc.saturday || svc.sunday : true;
  if (isWeekend && runsWeekend && WEEKEND_LOCAL.has(id)) return "Local";
  return base;
}

export const ROUTE_ORDER = Object.keys(ROUTES);

export function routeInfo(id: string): RouteInfo {
  return (
    ROUTES[id] ?? { id, name: `Route ${id}`, color: "#808183", textColor: "#FFFFFF" }
  );
}
