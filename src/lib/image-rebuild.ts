// Content disarm for photos: decode the JPEG to raw pixels and encode a brand-new
// JPEG from them. Nothing from the original file survives except the picture:
// no metadata (EXIF/GPS), comments, trailing data or embedded payloads. Pure
// JavaScript (jpeg-js), so it runs wherever the server runs. Throws on anything
// that is not a decodable JPEG within the size limits.
import { decode, encode } from "jpeg-js";

const MAX_SIDE = 4000;

export function isJpeg(bytes: Uint8Array) {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function rebuildJpeg(bytes: Uint8Array, quality = 85): Uint8Array {
  if (!isJpeg(bytes)) throw new Error("Not a JPEG");
  const image = decode(bytes, {
    useTArray: true,
    formatAsRGBA: true,
    tolerantDecoding: false,
    maxResolutionInMP: 16,
    maxMemoryUsageInMB: 160,
  });
  if (!image.width || !image.height || image.width > MAX_SIDE || image.height > MAX_SIDE)
    throw new Error("Image size not allowed");
  const out = encode({ data: image.data, width: image.width, height: image.height }, quality);
  return new Uint8Array(out.data);
}
