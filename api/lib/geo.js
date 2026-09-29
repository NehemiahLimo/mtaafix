export function distanceMeters(a, b) {
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const left =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(left), Math.sqrt(1 - left));
}

export function roughGeohash(location) {
  // A cheap bucket for MVP candidate lookup. Replace with real geohash if needed.
  return `${location.lat.toFixed(2)}:${location.lng.toFixed(2)}`;
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}
