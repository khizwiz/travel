import { describe, expect, it } from "vitest";
import { readExifGps } from "@/lib/exif-gps";

// A hand-built EXIF block, because the offsets in this parser are the kind of
// thing that is either exactly right or silently returns a plausible wrong
// number — and a wrong coordinate puts a family photo on the wrong continent.

function buildExifJpeg(opts: {
  lat: [number, number, number];
  lng: [number, number, number];
  latRef: string;
  lngRef: string;
  little?: boolean;
}): Blob {
  const little = opts.little ?? true;
  // TIFF block: header(8) + IFD0(1 entry) + GPS IFD(4 entries) + rationals.
  const size = 8 + 2 + 12 + 4 + 2 + 4 * 12 + 4 + 48;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  const u16 = (at: number, n: number) => v.setUint16(at, n, little);
  const u32 = (at: number, n: number) => v.setUint32(at, n, little);

  // TIFF header
  v.setUint8(0, little ? 0x49 : 0x4d);
  v.setUint8(1, little ? 0x49 : 0x4d);
  u16(2, 42);
  u32(4, 8); // IFD0 at offset 8

  // IFD0: one entry, the GPS IFD pointer
  const ifd0 = 8;
  u16(ifd0, 1);
  u16(ifd0 + 2, 0x8825); // GPS IFD tag
  u16(ifd0 + 4, 4); // LONG
  u32(ifd0 + 6, 1);
  const gpsIfd = ifd0 + 2 + 12 + 4;
  u32(ifd0 + 10, gpsIfd);
  u32(ifd0 + 2 + 12, 0); // next IFD = none

  // GPS IFD: 4 entries
  u16(gpsIfd, 4);
  const rationals = gpsIfd + 2 + 4 * 12 + 4;

  const entry = (i: number, tag: number, type: number, count: number, value: number) => {
    const at = gpsIfd + 2 + i * 12;
    u16(at, tag);
    u16(at + 2, type);
    u32(at + 4, count);
    u32(at + 8, value);
  };
  // Refs are single ASCII chars stored inline in the value field.
  const refValue = (ch: string) =>
    little ? ch.charCodeAt(0) : ch.charCodeAt(0) << 24;
  entry(0, 1, 2, 2, refValue(opts.latRef));
  entry(1, 2, 5, 3, rationals);
  entry(2, 3, 2, 2, refValue(opts.lngRef));
  entry(3, 4, 5, 3, rationals + 24);
  u32(gpsIfd + 2 + 4 * 12, 0);

  const writeDms = (at: number, dms: [number, number, number]) => {
    dms.forEach((n, i) => {
      u32(at + i * 8, Math.round(n * 1000));
      u32(at + i * 8 + 4, 1000);
    });
  };
  writeDms(rationals, opts.lat);
  writeDms(rationals + 24, opts.lng);

  // Wrap: some leading bytes, the Exif marker, then the TIFF block.
  const head = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x00]);
  const marker = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
  return new Blob([head, marker, new Uint8Array(buf)]);
}

describe("readExifGps", () => {
  it("reads coordinates from a little-endian EXIF block", async () => {
    // Rimini, roughly: 44°03'32"N 12°34'06"E
    const gps = await readExifGps(
      buildExifJpeg({ lat: [44, 3, 32], lng: [12, 34, 6], latRef: "N", lngRef: "E" }),
    );
    expect(gps).not.toBeNull();
    expect(gps!.lat).toBeCloseTo(44.0589, 3);
    expect(gps!.lng).toBeCloseTo(12.5683, 3);
  });

  it("reads big-endian blocks too", async () => {
    const gps = await readExifGps(
      buildExifJpeg({
        lat: [41, 0, 30],
        lng: [28, 58, 42],
        latRef: "N",
        lngRef: "E",
        little: false,
      }),
    );
    expect(gps).not.toBeNull();
    expect(gps!.lat).toBeCloseTo(41.0083, 3);
    expect(gps!.lng).toBeCloseTo(28.9783, 3);
  });

  it("applies south and west references as negative", async () => {
    const gps = await readExifGps(
      buildExifJpeg({ lat: [33, 55, 0], lng: [18, 25, 0], latRef: "S", lngRef: "W" }),
    );
    expect(gps!.lat).toBeLessThan(0);
    expect(gps!.lng).toBeLessThan(0);
    expect(gps!.lat).toBeCloseTo(-33.9167, 3);
    expect(gps!.lng).toBeCloseTo(-18.4167, 3);
  });

  it("returns null for a file with no EXIF at all", async () => {
    expect(await readExifGps(new Blob([new Uint8Array(4096)]))).toBeNull();
  });

  it("ignores a stray 'Exif' string that is not followed by a TIFF header", async () => {
    const junk = new TextEncoder().encode("Exif\0\0this is not tiff data at all");
    expect(await readExifGps(new Blob([junk]))).toBeNull();
  });

  it("treats null island as no location", async () => {
    const gps = await readExifGps(
      buildExifJpeg({ lat: [0, 0, 0], lng: [0, 0, 0], latRef: "N", lngRef: "E" }),
    );
    expect(gps).toBeNull();
  });
});
