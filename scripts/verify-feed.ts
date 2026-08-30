import * as GtfsRealtimeBindings from "gtfs-realtime-bindings";

const url = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace";
const res = await fetch(url);
const buf = await res.arrayBuffer();
const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buf));
let total = 0, withStu = 0;
for (const e of feed.entity) {
  total++;
  const tu = e.tripUpdate;
  if (!tu?.stopTimeUpdate) continue;
  withStu++;
  if (withStu <= 3) {
    console.log("route:", tu.trip?.routeId, "stops:", tu.stopTimeUpdate.length, "first stopId:", tu.stopTimeUpdate[0]?.stopId);
  }
}
console.log("entities:", total, "with tripUpdate:", withStu);
