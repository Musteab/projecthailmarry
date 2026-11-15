# Recorded official feed samples

Retrieved 2026-11-15 using the generic identity `bastion-hackathon-demo`. The samples retain up to three features. The NWS Portland point query returned no active alerts; this is a valid empty sample. Earthquake samples are not Portland events and are filtered by distance during replay.

- [NWS point-alert API](https://www.weather.gov/documentation/services-web-alerts): `https://api.weather.gov/alerts/active?point=45.49,-122.64`.
- [USGS earthquake GeoJSON](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php): past-day feed.
- [USGS Water Data API](https://api.waterdata.usgs.gov/ogcapi/v0/): `latest-continuous`, parameter `00065`, monitoring location `USGS-14211550`.
- [Johnson Creek at Milwaukie station](https://waterdata.usgs.gov/monitoring-location/USGS-14211550/).

Gauge height is referenced to the station datum. It is not flood depth above a road and is not automatically a threshold exceedance. Replay samples are historical observations, not current warnings.
