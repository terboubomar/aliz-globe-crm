// Before upload, photos are redrawn in the browser: the browser applies the
// camera's rotation, the image is scaled to at most 1800px and saved as JPEG.
// Redrawing drops EXIF (including GPS location), like the original server's
// re-encode step. The server strips metadata again in case this is bypassed.
const MAX = 1800;

export async function prepareImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("تعذر قراءة الصورة. اختر صورة JPG أو PNG أو WebP.");
  }
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale),
    height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.85));
  if (!blob) throw new Error("تعذر تجهيز الصورة للرفع");
  return blob;
}
