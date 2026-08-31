// Resolves the text payload of a scanned QR code to an MTA station.
//
// MTA's colorful NaviLens codes are proprietary matrix codes that only the
// NaviLens app can decode — a standard QR reader cannot read them. What CAN be
// read and mapped here:
//   - NaviLens GO / AQR codes (standard QR) whose payload mentions the station
//   - MTA station-info QR codes linking to https://new.mta.info/stations/<slug>
//   - any QR whose text contains a station name (e.g. "Times Square")
import { STATIONS, type Station } from "@/lib/stations";

// Real-world names/aliases -> GTFS station names. Longer phrases first so
// "times square" doesn't shadow anything and exact matches win.
const ALIASES: [string, string][] = [
  ["times square", "Times Sq-42 St"],
  ["grand central", "Grand Central-42 St"],
  ["port authority", "42 St-Port Authority Bus Terminal"],
  ["bryant park", "42 St-Bryant Pk"],
  ["union square", "14 St-Union Sq"],
  ["herald square", "34 St-Herald Sq"],
  ["penn station", "34 St-Penn Station"],
  ["columbus circle", "59 St-Columbus Circle"],
  ["fulton center", "Fulton St"],
  ["fulton street", "Fulton St"],
  ["barclays center", "Atlantic Av-Barclays Ctr"],
  ["barclays", "Atlantic Av-Barclays Ctr"],
  ["atlantic avenue", "Atlantic Av-Barclays Ctr"],
  ["atlantic ave", "Atlantic Av-Barclays Ctr"],
  ["world trade center", "World Trade Center"],
  ["wall street", "Wall St"],
  ["flushing main", "Flushing-Main St"],
  ["hunters point", "Hunters Point Av"],
  ["court square", "Court Sq"],
  ["jay street", "Jay St-MetroTech"],
  ["borough hall", "Borough Hall"],
  ["delancey street", "Delancey St-Essex St"],
  ["essex street", "Delancey St-Essex St"],
  ["broadway junction", "Broadway Junction"],
  ["canal street", "Canal St"],
  ["bleecker street", "Bleecker St"],
  ["astor place", "Astor Pl"],
  ["spring street", "Spring St"],
  ["houston street", "Houston St"],
  ["christopher street", "Christopher St-Stonewall"],
  ["86 street", "86 St"],
  ["125 street", "125 St"],
  ["rockaway park", "Rockaway Park-Beach 116 St"],
  ["howard beach", "Howard Beach-JFK Airport"],
  ["whitehall street", "Whitehall St-South Ferry"],
  ["south ferry", "South Ferry"],
  ["pelham bay park", "Pelham Bay Park"],
  ["jamaica center", "Jamaica Center-Parsons/Archer"],
];

// Street-ish suffixes that add no signal when matching names ("86 St" -> "86").
const STOPWORDS = new Set([
  "st", "street", "av", "ave", "avenue", "pl", "place", "rd", "road", "blvd",
  "pk", "park", "sq", "square", "the", "and", "&",
]);

function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
}

// Significant tokens: no stopwords, keep short meaningful tokens like "86".
function sig(text: string): string[] {
  return tokens(text).filter((t) => !STOPWORDS.has(t) && t.length > 1);
}

// Exact-ish match: does the payload contain the station's name as a whole-token
// sequence (punctuation/hyphens treated as spaces)? Token-based so "Atlantic Av"
// does NOT match "Atlantic Avenue" ("av" is not a token there).
function exactContains(payload: string, name: string): boolean {
  const p = tokens(payload);
  const n = tokens(name);
  if (n.length === 0) return false;
  outer: for (let i = 0; i + n.length <= p.length; i++) {
    for (let j = 0; j < n.length; j++) {
      if (p[i + j] !== n[j]) continue outer;
    }
    return true;
  }
  return false;
}

// Longest names first so e.g. "Atlantic Av-Barclays Ctr" wins over the
// prefix-matching "Atlantic Av" when a payload says "Atlantic Avenue".
const STATIONS_BY_LENGTH = [...STATIONS].sort((a, b) => b.name.length - a.name.length);

export function resolveStationFromQr(payload: string): Station | null {
  if (!payload) return null;
  const lower = payload.toLowerCase();

  // 1) Station names written out exactly (or with punctuation differences).
  for (const s of STATIONS_BY_LENGTH) {
    if (exactContains(lower, s.name)) return s;
  }

  // 2) Common aliases / real-world names.
  for (const [phrase, name] of ALIASES) {
    if (lower.includes(phrase)) {
      const st = STATIONS.find((s) => s.name === name);
      if (st) return st;
    }
  }

  // 3) Fuzzy token overlap with the full payload (URL slugs included).
  const payloadSig = new Set(sig(payload));
  if (payloadSig.size === 0) return null;
  let best: Station | null = null;
  let bestScore = 0;
  for (const s of STATIONS) {
    const stationSig = sig(s.name);
    if (stationSig.length === 0) continue;
    let matched = 0;
    for (const t of stationSig) if (payloadSig.has(t)) matched++;
    const score = matched / stationSig.length;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return bestScore >= 0.6 && bestScore > 0 ? best : null;
}
