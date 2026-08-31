// MTA subway route metadata (colors + names), mirroring the official line colors.
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
  "7": { id: "7", name: "Flushing Local", color: "#B933AD", textColor: "#FFFFFF" },
  A: { id: "A", name: "8 Avenue Express", color: "#0039A6", textColor: "#FFFFFF" },
  C: { id: "C", name: "8 Avenue Local", color: "#0039A6", textColor: "#FFFFFF" },
  E: { id: "E", name: "8 Avenue Local", color: "#0039A6", textColor: "#FFFFFF" },
  B: { id: "B", name: "6 Avenue Express", color: "#FF6319", textColor: "#FFFFFF" },
  D: { id: "D", name: "6 Avenue Express", color: "#FF6319", textColor: "#FFFFFF" },
  F: { id: "F", name: "6 Avenue Local", color: "#FF6319", textColor: "#FFFFFF" },
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

export const ROUTE_ORDER = Object.keys(ROUTES);

export function routeInfo(id: string): RouteInfo {
  return (
    ROUTES[id] ?? { id, name: `Route ${id}`, color: "#808183", textColor: "#FFFFFF" }
  );
}
