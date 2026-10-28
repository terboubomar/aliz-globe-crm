// Server-only: private evidence storage. Import dynamically from handlers.
import { admin } from "./core.server";

const BUCKET = "evidence";

/** Store a file in the private evidence bucket, creating the bucket on first use. */
export async function putEvidence(key: string, bytes: Uint8Array, mime: string) {
  const db = await admin();
  const put = () =>
    db.storage.from(BUCKET).upload(key, bytes, { contentType: mime, upsert: false });
  let { error } = await put();
  if (error && /not.?found/i.test(error.message)) {
    // Private: files are only reachable through short-lived signed links for staff.
    await db.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: 8 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    });
    ({ error } = await put());
  }
  return error;
}
