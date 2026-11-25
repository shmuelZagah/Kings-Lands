/**
 * Fast content hash for game data (FNV-1a, 8 hex chars).
 *
 * Plain JSON.stringify of the whole data is slow because of the large mesh arrays (vertices / faces / colors / ...).
 * Those are hashed numerically instead of being turned into text; every other value goes through a key-sorted
 * JSON text, so the hash does not depend on key order. The same data always gives the same hash.
 */
export const BLOB_KEYS = new Set(['vertices', 'faces', 'indices', 'colors', 'normals', 'uvs']);
export const BLOB_MIN = 32;

function fnvNumbers(arr, h) {
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (typeof v === 'number') {
      h ^= (v * 1000) | 0;
      h = Math.imul(h, 0x01000193);
    } else if (Array.isArray(v)) {
      h = fnvNumbers(v, h);
    }
  }
  return h;
}

export function dataHash(value) {
  const text = JSON.stringify(value, function replacer(k, v) {
    if (v && typeof v === 'object') {
      if (Array.isArray(v)) {
        if (v.length >= BLOB_MIN && BLOB_KEYS.has(k)) {
          return 'blob:' + v.length + ':' + (fnvNumbers(v, 0x811c9dc5) >>> 0).toString(16);
        }
        return v;
      }
      const keys = Object.keys(v).sort();
      const out = {};
      for (const key of keys) out[key] = v[key];
      return out;
    }
    return v;
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
