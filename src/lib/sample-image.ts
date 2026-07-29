/**
 * Procedurally generated placeholder photos.
 *
 * These exist to prove the story pipeline end to end — bucket write, row
 * insert, companion-post trigger, signed URL, and rendering on the feed and the
 * map — without waiting for someone to be somewhere photogenic.
 *
 * They are drawn here rather than downloaded: a real stock photo would drag in
 * someone's licence terms and an external fetch that can fail, for a picture
 * whose only job is to be visibly present. Each is a stylised landscape keyed
 * to a city, so the timeline looks like a timeline.
 *
 * The PNG encoder below is deliberately dependency-free and uses uncompressed
 * (stored) deflate blocks. Workers have no zlib, and a real compressor would be
 * a lot of code to save bytes nobody is paying for on a handful of samples.
 */

// ── PNG encoding ─────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([...type].map((c) => c.charCodeAt(0)));
  const body = concat([typeBytes, data]);
  return concat([u32(data.length), body, u32(crc32(body))]);
}

/** A valid zlib stream carrying `raw` verbatim in stored deflate blocks. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  const MAX = 65535;
  for (let at = 0; at < raw.length; at += MAX) {
    const len = Math.min(MAX, raw.length - at);
    const final = at + len >= raw.length ? 1 : 0;
    const nlen = ~len & 0xffff;
    parts.push(
      new Uint8Array([final, len & 0xff, (len >> 8) & 0xff, nlen & 0xff, (nlen >> 8) & 0xff]),
    );
    parts.push(raw.subarray(at, at + len));
  }
  parts.push(u32(adler32(raw)));
  return concat(parts);
}

/** Encode 8-bit RGB pixel rows as a PNG. `rgb` is width*height*3 bytes. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const stride = width * 3;
  // PNG scanlines are each prefixed with a filter byte; 0 means "no filter".
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = concat([
    u32(width),
    u32(height),
    new Uint8Array([8, 2, 0, 0, 0]), // 8-bit, truecolour RGB, no interlace
  ]);
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibStored(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

// ── Drawing ──────────────────────────────────────────────────────────────────

export const SAMPLE_WIDTH = 560;
/** 4:5, matching the aspect the story card crops to. */
export const SAMPLE_HEIGHT = 700;

type RGB = [number, number, number];

export interface Palette {
  skyTop: RGB;
  skyHorizon: RGB;
  sun: RGB;
  hillsFar: RGB;
  hillsNear: RGB;
  ground: RGB;
}

/** A few distinct times-of-day so the feed does not look like one photo. */
export const PALETTES: Palette[] = [
  {
    // Dawn
    skyTop: [38, 52, 92], skyHorizon: [242, 168, 116], sun: [255, 232, 168],
    hillsFar: [92, 96, 132], hillsNear: [46, 52, 74], ground: [30, 34, 50],
  },
  {
    // Clear midday
    skyTop: [58, 122, 196], skyHorizon: [168, 214, 238], sun: [255, 250, 224],
    hillsFar: [126, 156, 128], hillsNear: [74, 108, 82], ground: [52, 78, 58],
  },
  {
    // Golden hour
    skyTop: [96, 76, 140], skyHorizon: [246, 182, 96], sun: [255, 222, 140],
    hillsFar: [140, 108, 104], hillsNear: [82, 62, 66], ground: [58, 44, 46],
  },
  {
    // Adriatic afternoon
    skyTop: [42, 106, 168], skyHorizon: [186, 226, 232], sun: [255, 248, 212],
    hillsFar: [104, 152, 160], hillsNear: [48, 104, 118], ground: [30, 76, 92],
  },
  {
    // Dusk
    skyTop: [26, 32, 62], skyHorizon: [186, 106, 122], sun: [252, 206, 178],
    hillsFar: [74, 70, 104], hillsNear: [40, 40, 62], ground: [26, 26, 42],
  },
  {
    // Hazy hills
    skyTop: [122, 148, 176], skyHorizon: [222, 226, 220], sun: [255, 255, 246],
    hillsFar: [150, 162, 150], hillsNear: [96, 116, 100], ground: [70, 88, 74],
  },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

/**
 * Draw a stylised landscape. `seed` shifts the ridgelines and the sun so each
 * sample is recognisably its own picture rather than a recoloured copy.
 */
export function drawSampleLandscape(seed: number, palette: Palette): Uint8Array {
  const w = SAMPLE_WIDTH;
  const h = SAMPLE_HEIGHT;
  const rgb = new Uint8Array(w * h * 3);

  const horizonY = Math.round(h * 0.62);
  const sunX = Math.round(w * (0.22 + 0.56 * ((Math.sin(seed * 1.7) + 1) / 2)));
  const sunY = Math.round(horizonY * (0.32 + 0.34 * ((Math.cos(seed * 2.3) + 1) / 2)));
  const sunR = Math.round(w * 0.075);

  // Ridgelines: two layers of summed sines, so they read as hills, not noise.
  const ridge = (x: number, layer: number): number => {
    const p = layer === 0 ? 1 : 1.6;
    const base = horizonY - (layer === 0 ? h * 0.1 : h * 0.035);
    const amp = layer === 0 ? h * 0.055 : h * 0.038;
    const k = (x / w) * Math.PI * 2;
    return (
      base -
      amp *
        (0.6 * Math.sin(k * p + seed) +
          0.3 * Math.sin(k * (2.3 * p) + seed * 1.9) +
          0.2 * Math.sin(k * (4.1 * p) + seed * 0.7))
    );
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c: RGB;

      if (y < horizonY) {
        // Sky, plus a soft sun with a halo.
        const t = y / horizonY;
        c = mix(palette.skyTop, palette.skyHorizon, Math.pow(t, 1.35));
        const d = Math.hypot(x - sunX, y - sunY);
        if (d < sunR) {
          c = mix(c, palette.sun, 0.92);
        } else if (d < sunR * 3.2) {
          const glow = 1 - (d - sunR) / (sunR * 2.2);
          c = mix(c, palette.sun, Math.max(0, glow) * 0.4);
        }
        // Hills sit in front of the sky.
        if (y > ridge(x, 0)) c = palette.hillsFar;
        if (y > ridge(x, 1)) c = palette.hillsNear;
      } else {
        // Foreground, darkening towards the bottom edge.
        const t = (y - horizonY) / (h - horizonY);
        c = mix(palette.hillsNear, palette.ground, Math.pow(t, 0.7));
        // A dropped reflection of the sun, so water reads as water.
        const refl = Math.exp(-Math.pow((x - sunX) / (sunR * 1.9), 2)) * (1 - t) * 0.5;
        const ripple = 0.55 + 0.45 * Math.sin(y * 0.9 + Math.sin(x * 0.05 + seed) * 2);
        c = mix(c, palette.sun, refl * ripple);
      }

      // A gentle vignette to stop the flat areas looking like a CSS gradient.
      const vx = (x / w - 0.5) * 2;
      const vy = (y / h - 0.5) * 2;
      const vig = 1 - 0.16 * (vx * vx + vy * vy);

      const i = (y * w + x) * 3;
      rgb[i] = Math.max(0, Math.min(255, Math.round(c[0] * vig)));
      rgb[i + 1] = Math.max(0, Math.min(255, Math.round(c[1] * vig)));
      rgb[i + 2] = Math.max(0, Math.min(255, Math.round(c[2] * vig)));
    }
  }

  return rgb;
}

/** A ready-to-upload PNG for sample index `n`. */
export function buildSamplePng(n: number): Uint8Array {
  const palette = PALETTES[n % PALETTES.length];
  return encodePng(
    SAMPLE_WIDTH,
    SAMPLE_HEIGHT,
    drawSampleLandscape(n * 1.37 + 0.4, palette),
  );
}
