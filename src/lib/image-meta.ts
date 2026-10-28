// Removes metadata that can identify a customer (camera GPS, device, comments)
// from uploaded images, without decoding them. Pure: no Node or browser APIs.
// JPEG: drops APP1 (EXIF/XMP), APP13 (IPTC) and COM segments; keeps colour data.
// PNG: drops eXIf and text/time chunks.

export type ImageKind = "image/jpeg" | "image/png";

export function imageKind(bytes: Uint8Array): ImageKind | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => bytes[i] === b)) return "image/png";
  return null;
}

const dropJpeg = new Set([0xe1, 0xed, 0xfe]);
const dropPng = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripJpeg(src: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [src.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= src.length) {
    if (src[i] !== 0xff) throw new Error("Corrupt JPEG");
    const marker = src[i + 1]!;
    // Start of scan: the rest is image data.
    if (marker === 0xda) {
      out.push(src.subarray(i));
      return concat(out);
    }
    // Markers without a length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(src.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const length = (src[i + 2]! << 8) | src[i + 3]!;
    if (length < 2 || i + 2 + length > src.length) throw new Error("Corrupt JPEG");
    if (!dropJpeg.has(marker)) out.push(src.subarray(i, i + 2 + length));
    i += 2 + length;
  }
  throw new Error("Corrupt JPEG");
}

function stripPng(src: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [src.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= src.length) {
    const length = ((src[i]! << 24) | (src[i + 1]! << 16) | (src[i + 2]! << 8) | src[i + 3]!) >>> 0;
    const end = i + 12 + length;
    if (end > src.length) throw new Error("Corrupt PNG");
    const type = String.fromCharCode(src[i + 4]!, src[i + 5]!, src[i + 6]!, src[i + 7]!);
    if (!dropPng.has(type)) out.push(src.subarray(i, end));
    i = end;
    if (type === "IEND") return concat(out);
  }
  throw new Error("Corrupt PNG");
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The image without identifying metadata; throws if the bytes are not a well-formed JPEG/PNG. */
export function stripImageMetadata(bytes: Uint8Array): { kind: ImageKind; bytes: Uint8Array } {
  const kind = imageKind(bytes);
  if (!kind) throw new Error("Unsupported image");
  return { kind, bytes: kind === "image/jpeg" ? stripJpeg(bytes) : stripPng(bytes) };
}
