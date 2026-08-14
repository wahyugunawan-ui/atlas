/**
 * Hitungan geometri untuk peta.
 *
 * Keduanya menentukan apa yang dilihat orang di peta — lingkaran yang salah ukuran
 * atau jarak yang salah satuan tidak akan muncul sebagai error, cuma sebagai angka
 * yang salah. Karena itu diuji, bukan diperiksa dengan mata. Lihat test/geo.test.js.
 *
 * Murni: tidak menyentuh DOM maupun MapLibre.
 */

/** Poligon lingkaran radius dalam derajat. Bujur dikoreksi menurut lintang. */
export function circle(lng, lat, meters, sides) {
  const n = sides || 64;
  const dLat = meters / 111320;
  const dLng = meters / (111320 * Math.cos(lat * Math.PI / 180));
  const points = [];
  for (let i = 0; i <= n; i++) {
    const angle = (i / n) * 2 * Math.PI;
    points.push([lng + dLng * Math.cos(angle), lat + dLat * Math.sin(angle)]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [points] },
  };
}

/** Jarak haversine dalam meter. */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** FeatureCollection kosong. Dipakai untuk mengosongkan lapisan tanpa membuangnya. */
export const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] };
