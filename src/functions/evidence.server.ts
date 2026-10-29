// Server-only: private evidence storage. Import dynamically from handlers.
import { DomainError } from "@/lib/domain";
import { rebuildJpeg } from "@/lib/image-rebuild";
import { admin } from "./core.server";

const BUCKET = "evidence";

/** Store a file in the private evidence bucket, creating the bucket on first use. */
export async function putEvidence(key: string, bytes: Uint8Array, mime: string, replace = false) {
  const db = await admin();
  const put = () =>
    db.storage.from(BUCKET).upload(key, bytes, { contentType: mime, upsert: replace });
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

export async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Photo safety in place of a malware scanner (owner decision): every photo is
 * decoded to pixels and re-encoded as a new JPEG, so nothing hidden in the
 * uploaded file is kept. Only the rebuilt file is ever stored as CLEAN.
 */
export function cleanPhoto(bytes: Uint8Array) {
  try {
    return rebuildJpeg(bytes);
  } catch {
    throw new DomainError("INVALID_IMAGE", 400, "يسمح بالصور فقط (JPG)؛ تعذر قراءة الصورة");
  }
}

/**
 * Photos stored before the rebuild step existed are PENDING_SCAN. Rebuild one in
 * place the first time staff open it; anything that cannot be rebuilt stays
 * pending and is never served.
 */
export async function clearPending(id: string, key: string, actor: string) {
  const db = await admin();
  const { data: file, error } = await db.storage.from(BUCKET).download(key);
  if (error || !file) return false;
  let clean: Uint8Array;
  try {
    clean = rebuildJpeg(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return false;
  }
  if (await putEvidence(key, clean, "image/jpeg", true)) return false;
  const { error: e2 } = await db
    .from("attachments")
    .update({
      status: "CLEAN",
      mime: "image/jpeg",
      size: clean.length,
      checksum: await sha256Hex(clean),
    })
    .eq("id", id)
    .eq("status", "PENDING_SCAN");
  if (e2) return false;
  await db.rpc("write_audit", { _actor: actor, _action: "EVIDENCE_REBUILT", _entity: id });
  return true;
}
