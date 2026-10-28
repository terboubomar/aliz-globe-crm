import { describe, expect, it } from "vitest";
import { imageKind, stripImageMetadata } from "@/lib/image-meta";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );
const segment = (marker: number, body: number[] | string) => {
  const b = typeof body === "string" ? [...body].map((c) => c.charCodeAt(0)) : body;
  const len = b.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...b];
};
const text = (u: Uint8Array) => String.fromCharCode(...u);

describe("photo metadata", () => {
  it("removes EXIF (GPS), IPTC and comments from JPEGs but keeps the image", () => {
    const jpeg = bytes(
      [0xff, 0xd8],
      segment(0xe0, "JFIF\0"),
      segment(0xe1, "Exif\0\0GPS 24.7136,46.6753"),
      segment(0xed, "Photoshop IPTC owner"),
      segment(0xfe, "comment: Customer phone"),
      segment(0xe2, "ICC_PROFILE"),
      segment(0xdb, [0, 1, 2, 3]),
      [0xff, 0xda, 0, 4, 9, 9, 0x11, 0x22, 0x33, 0xff, 0xd9],
    );
    const out = stripImageMetadata(jpeg);
    expect(out.kind).toBe("image/jpeg");
    const t = text(out.bytes);
    for (const gone of ["Exif", "GPS", "IPTC", "Customer phone"]) expect(t).not.toContain(gone);
    for (const kept of ["JFIF", "ICC_PROFILE"]) expect(t).toContain(kept);
    // Scan data and end-of-image untouched.
    expect([...out.bytes.slice(-5)]).toEqual([0x11, 0x22, 0x33, 0xff, 0xd9]);
  });

  it("removes text and EXIF chunks from PNGs", () => {
    const chunk = (type: string, data: string) => {
      const n = data.length;
      return [
        (n >>> 24) & 255,
        (n >>> 16) & 255,
        (n >>> 8) & 255,
        n & 255,
        ...[...(type + data)].map((c) => c.charCodeAt(0)),
        0,
        0,
        0,
        0,
      ];
    };
    const png = bytes(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      chunk("IHDR", "0123456789abc"),
      chunk("tEXt", "Author\0Customer"),
      chunk("eXIf", "GPS"),
      chunk("IDAT", "pixels"),
      chunk("IEND", ""),
    );
    const out = stripImageMetadata(png);
    const t = text(out.bytes);
    expect(t).toContain("IHDR");
    expect(t).toContain("pixels");
    expect(t).not.toContain("Customer");
    expect(t).not.toContain("eXIf");
  });

  it("rejects anything that is not a well-formed JPEG or PNG", () => {
    expect(imageKind(bytes("GIF89a"))).toBeNull();
    expect(() => stripImageMetadata(bytes("<svg onload=alert(1)>"))).toThrow();
    expect(() => stripImageMetadata(bytes([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toThrow();
  });
});
