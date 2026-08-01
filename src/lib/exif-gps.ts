/**
 * Read GPS coordinates out of a photo's EXIF metadata.
 *
 * This is the best answer to "where was this taken" by a wide margin: the
 * camera recorded it at the moment of the shot. Everything else the app can
 * fall back on — the phone's position at upload time, the hotel booked for
 * that day — is an approximation of an approximation.
 *
 * Must run on the ORIGINAL file. Re-encoding a photo through a canvas (which
 * is how HEIC becomes JPEG, and how large photos get scaled down) drops every
 * EXIF tag, so reading has to happen before that.
 *
 * Deliberately dependency-free and format-agnostic: rather than parsing JPEG
 * segment structure or the ISO-BMFF box tree that HEIC uses, it finds the
 * `Exif\0\0` marker and parses the TIFF block that follows. That block has the
 * same layout wherever it is embedded, so one parser covers JPEG and HEIC. The
 * TIFF header is validated straight after the marker, so a chance byte
 * sequence cannot be mistaken for metadata.
 */

export interface ExifGps {
  lat: number;
  lng: number;
}

/** EXIF lives near the start of the file; no need to read a 12 MB photo. */
const SCAN_BYTES = 2 * 1024 * 1024;

const TAG_GPS_IFD = 0x8825;
const GPS_LAT_REF = 1;
const GPS_LAT = 2;
const GPS_LNG_REF = 3;
const GPS_LNG = 4;

class Reader {
  constructor(
    private readonly view: DataView,
    private readonly little: boolean,
  ) {}
  u16(at: number): number {
    return this.view.getUint16(at, this.little);
  }
  u32(at: number): number {
    return this.view.getUint32(at, this.little);
  }
}

/** Three rationals — degrees, minutes, seconds — to decimal degrees. */
function dmsToDecimal(r: Reader, at: number, tiff: number, count: number): number | null {
  if (count < 3) return null;
  const parts: number[] = [];
  for (let i = 0; i < 3; i++) {
    const num = r.u32(tiff + at + i * 8);
    const den = r.u32(tiff + at + i * 8 + 4);
    if (den === 0) return null;
    parts.push(num / den);
  }
  const [deg, min, sec] = parts;
  if (![deg, min, sec].every(Number.isFinite)) return null;
  return deg + min / 60 + sec / 3600;
}

function findExifMarker(bytes: Uint8Array): number {
  // "Exif\0\0"
  for (let i = 0; i < bytes.length - 8; i++) {
    if (
      bytes[i] === 0x45 &&
      bytes[i + 1] === 0x78 &&
      bytes[i + 2] === 0x69 &&
      bytes[i + 3] === 0x66 &&
      bytes[i + 4] === 0x00 &&
      bytes[i + 5] === 0x00
    ) {
      const tiff = i + 6;
      const b0 = bytes[tiff];
      const b1 = bytes[tiff + 1];
      // Validate the TIFF header rather than trusting the marker alone.
      const littleEndian = b0 === 0x49 && b1 === 0x49;
      const bigEndian = b0 === 0x4d && b1 === 0x4d;
      if (!littleEndian && !bigEndian) continue;
      const magic = littleEndian
        ? bytes[tiff + 2] | (bytes[tiff + 3] << 8)
        : (bytes[tiff + 2] << 8) | bytes[tiff + 3];
      if (magic !== 42) continue;
      return tiff;
    }
  }
  return -1;
}

export async function readExifGps(file: Blob): Promise<ExifGps | null> {
  try {
    const buf = await file.slice(0, SCAN_BYTES).arrayBuffer();
    const bytes = new Uint8Array(buf);
    const tiff = findExifMarker(bytes);
    if (tiff < 0) return null;

    const view = new DataView(buf);
    const little = bytes[tiff] === 0x49;
    const r = new Reader(view, little);

    // IFD0, then its GPS sub-IFD pointer.
    const ifd0 = tiff + r.u32(tiff + 4);
    if (ifd0 + 2 > bytes.length) return null;
    const entries = r.u16(ifd0);
    let gpsOffset = -1;
    for (let i = 0; i < entries; i++) {
      const entry = ifd0 + 2 + i * 12;
      if (entry + 12 > bytes.length) return null;
      if (r.u16(entry) === TAG_GPS_IFD) {
        gpsOffset = tiff + r.u32(entry + 8);
        break;
      }
    }
    if (gpsOffset < 0 || gpsOffset + 2 > bytes.length) return null;

    const gpsEntries = r.u16(gpsOffset);
    let lat: number | null = null;
    let lng: number | null = null;
    let latRef = "N";
    let lngRef = "E";

    for (let i = 0; i < gpsEntries; i++) {
      const entry = gpsOffset + 2 + i * 12;
      if (entry + 12 > bytes.length) return null;
      const tag = r.u16(entry);
      const count = r.u32(entry + 4);
      const valueAt = r.u32(entry + 8);

      if (tag === GPS_LAT_REF) latRef = String.fromCharCode(bytes[entry + 8] || 0x4e);
      else if (tag === GPS_LNG_REF) lngRef = String.fromCharCode(bytes[entry + 8] || 0x45);
      else if (tag === GPS_LAT) lat = dmsToDecimal(r, valueAt, tiff, count);
      else if (tag === GPS_LNG) lng = dmsToDecimal(r, valueAt, tiff, count);
    }

    if (lat == null || lng == null) return null;
    if (latRef === "S") lat = -lat;
    if (lngRef === "W") lng = -lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    // A photo at exactly 0,0 is a null island artefact, not a location.
    if (lat === 0 && lng === 0) return null;

    return { lat, lng };
  } catch {
    return null;
  }
}
