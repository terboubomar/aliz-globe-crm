import { describe, expect, it } from "vitest";
import { decode, encode } from "jpeg-js";
import { rebuildJpeg } from "@/lib/image-rebuild";

// A small real JPEG: 16x8 pixels, left half red, right half blue.
function sample() {
  const width = 16,
    height = 8,
    data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const right = i % width >= width / 2;
    data.set(right ? [0, 0, 255, 255] : [255, 0, 0, 255], i * 4);
  }
  return new Uint8Array(encode({ data, width, height }, 95).data);
}
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const text = (u: Uint8Array) => String.fromCharCode(...u);

describe("photo rebuild", () => {
  it("keeps the picture but nothing else from the original file", () => {
    const original = sample();
    // Hide EXIF with a GPS position after SOI, and a payload after end-of-image.
    const exifBody = [...ascii("Exif\0\0GPS 24.7136,46.6753")];
    const exif = [0xff, 0xe1, (exifBody.length + 2) >> 8, (exifBody.length + 2) & 255, ...exifBody];
    const tainted = new Uint8Array([
      ...original.subarray(0, 2),
      ...exif,
      ...original.subarray(2),
      ...ascii("<script>payload</script>"),
    ]);
    const rebuilt = rebuildJpeg(tainted);
    for (const gone of ["Exif", "GPS", "payload"]) expect(text(rebuilt)).not.toContain(gone);
    const pixels = decode(rebuilt, { useTArray: true });
    expect([pixels.width, pixels.height]).toEqual([16, 8]);
    const at = (x: number) => [...pixels.data.subarray(x * 4, x * 4 + 3)];
    // Left is still red, right still blue (JPEG is lossy, so allow some drift).
    expect(at(1)[0]).toBeGreaterThan(200);
    expect(at(14)[2]).toBeGreaterThan(200);
  });

  it("refuses anything that is not a decodable JPEG", () => {
    expect(() => rebuildJpeg(new Uint8Array(ascii("GIF89a....")))).toThrow();
    expect(() => rebuildJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 2]))).toThrow();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() => rebuildJpeg(png)).toThrow();
  });
});
