import { describe, expect, it } from "vitest";
import { buildSamplePng, SAMPLE_HEIGHT, SAMPLE_WIDTH } from "@/lib/sample-image";

// The encoder is hand-rolled, so the structural guarantees a decoder relies on
// are worth asserting: get the CRC or the deflate framing wrong and the upload
// still "succeeds", leaving an unopenable file in the bucket.

const be32 = (b: Uint8Array, at: number) =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

describe("sample PNG encoder", () => {
  const png = buildSamplePng(0);

  it("starts with the PNG signature", () => {
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it("declares the expected dimensions in IHDR", () => {
    // 8-byte signature, then length(4) + "IHDR"(4), then width, height.
    expect(be32(png, 16)).toBe(SAMPLE_WIDTH);
    expect(be32(png, 20)).toBe(SAMPLE_HEIGHT);
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(2); // truecolour RGB
  });

  it("has well-formed chunks in order, each with a valid CRC", () => {
    const table = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })();
    const crc = (bytes: Uint8Array) => {
      let c = 0xffffffff;
      for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };

    const seen: string[] = [];
    let at = 8;
    while (at < png.length) {
      const len = be32(png, at);
      const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
      const body = png.subarray(at + 4, at + 8 + len);
      expect(be32(png, at + 8 + len)).toBe(crc(body));
      seen.push(type);
      at += 12 + len;
    }
    expect(at).toBe(png.length); // no trailing garbage
    expect(seen).toEqual(["IHDR", "IDAT", "IEND"]);
  });

  it("carries every scanline, with its filter byte", () => {
    // Stored deflate means the IDAT payload is the raw data plus framing, so
    // its size is a direct check that no rows were dropped.
    const expectedRaw = (SAMPLE_WIDTH * 3 + 1) * SAMPLE_HEIGHT;
    const blocks = Math.ceil(expectedRaw / 65535);
    const idatLen = be32(png, 8 + 12 + 13); // after signature + IHDR chunk
    expect(idatLen).toBe(2 + blocks * 5 + expectedRaw + 4);
  });

  it("gives different samples different pixels", () => {
    const a = buildSamplePng(1);
    const b = buildSamplePng(2);
    expect(a.length).toBe(b.length);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
