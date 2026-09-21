/**
 * Ikki koordinata orasidagi masofa (metrda), haversine formulasi.
 * Shahar masshtabida (bir necha km) xatoligi e'tiborsiz darajada kichik.
 */
export function distanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000; // Yer radiusi, metr
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(a))));
}
