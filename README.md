# MTA Real-Time Train Board

Live NYC subway departure board built on MTA's official developer data.

## Data sources (all official MTA)

- **GTFS-Realtime** — live trip updates, protobuf, no API key needed since 2025:
  `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-<group>`
- **GTFS static (supplemented)** — stations, routes, headsigns, refreshed hourly:
  `https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip`

## Run

```sh
bun install
bun run dev      # dev server
bun run build    # production build
```

## Structure

- `app/board/` — departure board UI (station picker, time horizon, route filter in settings)
- `app/api/arrivals/` — GTFS-RT feed fetcher/decoder
- `lib/data/` — generated GTFS static data (regenerate with `scripts/gen-gtfs-data.ts`)
- `scripts/` — GTFS data generator + feed verification
