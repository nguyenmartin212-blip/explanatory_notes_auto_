export const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in meters (fallback when $geoNear is unavailable). */
export function haversineM(lat1, lng1, lat2, lng2) {
  const phi1 = rad(lat1);
  const phi2 = rad(lat2);
  const dPhi = phi2 - phi1;
  const dLambda = rad(lng2 - lng1);
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1.0, Math.sqrt(a)));
}
