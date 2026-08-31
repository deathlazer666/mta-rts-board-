// Address geocoding for the Directions tab.
//
// Primary: the NYC Planning Labs Geosearch API (geosearch.planninglabs.nyc)
// — free, no API key, CORS-enabled, scoped to New York City. Fallback:
// OpenStreetMap Nominatim (validated to be inside the NYC area).
//
// The geocoders are fuzzy, so every result is validated: the matched street
// name must overlap the street tokens typed by the user. This prevents a typo
// like "52 willam st nyc" from silently resolving to a random "52-52 70
// Street, Maspeth" — instead the user gets a clear "couldn't find" error.

export type GeocodeResult = { lat: number; lon: number; label: string };

const cache = new Map<string, GeocodeResult>();

type Feature = {
  geometry: { coordinates: [number, number] };
  properties?: { label?: string; borough?: string; street?: string };
};

// ---- Street-token matching --------------------------------------------------
const STOPWORDS = new Set([
  "st", "street", "ave", "avenue", "av", "blvd", "boulevard", "rd", "road",
  "dr", "drive", "pl", "place", "ln", "lane", "ct", "court", "pkwy",
  "parkway", "hwy", "highway", "wy", "way", "ste", "suite", "fl", "floor",
  "apt", "apartment", "unit", "nyc", "new", "york", "ny", "manhattan",
  "brooklyn", "queens", "bronx", "staten", "island", "of", "the", "and",
  "at", "near", "&", "and", "west", "east", "north", "south",
]);

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function ordinalBase(token: string): number | null {
  const m = token.match(/^(\d+)(?:st|nd|rd|th)?$/);
  if (!m) return null;
  return Number(m[1]);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

const STREET_TYPES = new Set([
  "st", "street", "ave", "av", "avenue", "blvd", "boulevard", "rd", "road",
  "dr", "drive", "pl", "place", "ln", "lane", "ct", "court", "pkwy",
  "parkway", "hwy", "highway", "wy", "way", "ter", "terrace", "loop",
  "walk", "square", "sq", "cir", "circle", "expressway", "expwy",
]);
const BOROUGHS = new Map<string, string>([
  ["manhattan", "Manhattan"],
  ["brooklyn", "Brooklyn"],
  ["queens", "Queens"],
  ["bronx", "Bronx"],
  ["staten", "Staten Island"],
  ["si", "Staten Island"],
]);

// Which borough (if any) the query names, e.g. "125 st manhattan" -> Manhattan.
function boroughHint(query: string): string | null {
  const t = tokenize(query);
  // "island" alone is NOT enough (Coney Island is Brooklyn) — only "staten"
  // (or the SI abbreviation) implies Staten Island.
  if (t.includes("staten") || t.includes("si")) return "Staten Island";
  for (const tok of t) {
    const b = BOROUGHS.get(tok);
    if (b) return b;
  }
  return null;
}

// Score how well a query's street tokens match a geocoder result (label and/or
// the API's parsed `street` field). Returns false when the match is too weak
// to trust, so a fuzzy result can never silently point at the wrong street.
function validateStreetMatch(query: string, label: string, street?: string): boolean {
  // Intersection queries ("42nd St & 5th Ave") should never match an ADDRESS
  // like "42-05 27 STREET" that merely contains both numbers.
  if (/&|\band\b/.test(query) && /\d+[-.]\d+/.test(label)) return false;

  const qRaw = tokenize(query);
  const lRaw = tokenize([label, street].filter(Boolean).join(" "));
  const qLetters: string[] = [];
  const qStreets: number[] = [];
  for (let i = 0; i < qRaw.length; i++) {
    const t = qRaw[i];
    const next = qRaw[i + 1];
    if (/^\d+(st|nd|rd|th)$/.test(t)) {
      // "125th" is itself a street name.
      qStreets.push(ordinalBase(t)!);
    } else if (/^\d+$/.test(t) && next && STREET_TYPES.has(next)) {
      // "125 st" (missing the ordinal suffix) is a street name too.
      qStreets.push(Number(t));
    } else if (/[a-z]/.test(t) && !STOPWORDS.has(t)) {
      qLetters.push(t);
    }
  }
  // Places like "Coney Island" or "Port Authority" have no street tokens to
  // check — accept whatever the geocoder returned for them.
  if (qLetters.length === 0 && qStreets.length === 0) return true;

  const lLetters = lRaw.filter((t) => /[a-z]/.test(t) && !STOPWORDS.has(t));
  const lNumbers = lRaw.map(ordinalBase).filter((n): n is number => n !== null);

  // Every street word the user typed must match something in the result — a
  // "Flushing Main St" query has no business accepting a Main St in Briarwood.
  let score = 0;
  for (const qt of qLetters) {
    let best = 0;
    for (const lt of lLetters) {
      if (lt === qt) best = Math.max(best, 3);
      else if (qt.length >= 3 && lt.startsWith(qt)) best = Math.max(best, 2);
      else if (qt.length >= 4 && levenshtein(qt, lt) <= 1) best = Math.max(best, 2);
    }
    if (best === 0) return false;
    score += best;
  }
  for (const qn of qStreets) {
    if (lNumbers.some((ln) => ln === qn)) score += 2;
  }
  return score >= 2;
}

// Nominatim results can land anywhere in the US — require the NYC area.
const NYC_BOX = { minLat: 40.47, maxLat: 40.93, minLon: -74.3, maxLon: -73.66 };

// ---- Geocoders --------------------------------------------------------------
async function nycGeosearch(q: string): Promise<Feature[]> {
  const url = `https://geosearch.planninglabs.nyc/v2/search?size=5&text=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Couldn't reach the address lookup service. Try again.");
  const data = (await res.json()) as { features?: Feature[] };
  return data.features ?? [];
}

function featureToResult(f: Feature, fallbackLabel: string): GeocodeResult {
  const [lon, lat] = f.geometry.coordinates;
  return { lat: Number(lat), lon: Number(lon), label: f.properties?.label ?? fallbackLabel };
}

async function nominatim(q: string): Promise<GeocodeResult | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Couldn't reach the address lookup service. Try again.");
  const data = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  const hit = data[0];
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lon = Number(hit.lon);
  if (lat < NYC_BOX.minLat || lat > NYC_BOX.maxLat || lon < NYC_BOX.minLon || lon > NYC_BOX.maxLon) {
    return null;
  }
  return { lat, lon, label: hit.display_name };
}

// Progressively looser versions of the query (drop comma-parts, then words)
// as a last resort for e.g. "JFK Airport Terminal 5, Queens".
function attemptsFor(q: string): string[] {
  const attempts = [q];
  let cur = q;
  for (let i = 0; i < 3; i++) {
    const idx = cur.lastIndexOf(",");
    if (idx < 0) break;
    cur = cur.slice(0, idx).trim();
    if (cur) attempts.push(cur);
  }
  cur = q.replace(/,.*$/, "").trim();
  for (let i = 0; i < 4; i++) {
    const words = cur.split(/\s+/).filter(Boolean);
    if (words.length <= 2) break;
    words.pop();
    cur = words.join(" ");
    if (cur) attempts.push(cur);
  }
  return [...new Set(attempts)];
}

// ---- Public API -------------------------------------------------------------
export async function geocodeAddress(query: string): Promise<GeocodeResult> {
  const q = query.trim();
  if (!q) throw new Error("Enter an address.");
  const cached = cache.get(q.toLowerCase());
  if (cached) return cached;

  // NYC Geosearch first, over progressively looser versions of the query.
  // Every candidate is validated against the ORIGINAL query so loosening can't
  // accidentally accept a match that ignores the street name the user typed.
  const hint = boroughHint(q);
  for (const attempt of attemptsFor(q)) {
    const features = await nycGeosearch(attempt);
    // If the user named a borough, ONLY accept results from that borough —
    // otherwise "125 st manhattan" can silently land on 125th St, College
    // Point (Queens). When no borough-matching feature surfaces in this
    // attempt, move on to the next (looser) attempt instead of accepting a
    // wrong-borough hit.
    const candidates = hint ? features.filter((f) => f.properties?.borough === hint) : features;
    for (const f of candidates) {
      const label = f.properties?.label ?? attempt;
      if (validateStreetMatch(q, label, f.properties?.street)) {
        const result = featureToResult(f, attempt);
        cache.set(q.toLowerCase(), result);
        return result;
      }
    }
  }

  // Nominatim fallback (validated to be inside the NYC area).
  const fallback = await nominatim(q);
  if (fallback && validateStreetMatch(q, fallback.label) && (!hint || fallback.label.toLowerCase().includes(hint.toLowerCase()))) {
    cache.set(q.toLowerCase(), fallback);
    return fallback;
  }

  throw new Error(
    `Couldn't find "${q}". Check the spelling and add a borough — e.g. "52 William St, New York NY".`,
  );
}
