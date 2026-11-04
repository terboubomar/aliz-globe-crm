import { DomainError, can, inScope, slaMilestones, ticketNumber, type Actor } from "@/lib/domain";
import {
  aiMessages,
  cleanAi,
  decide,
  fillScript,
  readRules,
  starsOf,
  MAX_REPLY,
  type GoogleRules,
  type Stars,
  type StarRule,
} from "@/lib/google-reviews";
import { admin, rpcError, settings } from "./core.server";
import { decrypt, encrypt, keyedHash, randomToken, sha256 } from "./crypto.server";

/*
 * Google Business Profile reviews.
 *
 * Connecting: a super admin presses "Connect Google", signs in with the Google
 * account that manages the branches and allows access. Google sends back a
 * one-time code (checked against a short-lived state value) that is exchanged
 * for a refresh token, stored encrypted. Each branch is then linked to its
 * Google location.
 *
 * Every few minutes new reviews are fetched. A review written before the
 * connection, or already answered on Google, is only recorded. A new review
 * with few stars becomes a complaint (auto-assigned like a QR complaint), and
 * is answered by the rule for its star rating: a saved script or an AI draft,
 * posted straight away or kept for a staff member to approve.
 *
 * Reviewer names and review text are stored encrypted. The AI only receives
 * the star rating, the review text and the brand/branch names.
 *
 * Secrets (set in the project's secrets, never in code): GOOGLE_CLIENT_ID,
 * GOOGLE_CLIENT_SECRET. The callback address is PUBLIC_APP_ORIGIN +
 * /api/public/google/callback. Optional AI drafts use LOVABLE_API_KEY.
 */

const env = (k: string) => process.env[k] ?? "";
const NIL = "00000000-0000-0000-0000-000000000000";
const SCOPE = "https://www.googleapis.com/auth/business.manage";
const TOKEN_KEY = "google:token";
const SYNC_KEY = "google:sync";
const ACCOUNTS = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const INFO = "https://mybusinessbusinessinformation.googleapis.com/v1";
const REVIEWS = "https://mybusiness.googleapis.com/v4";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-2.5-flash";

type Token = { refresh: string; connectedAt: string; by: string; account?: string };
type SyncState = { at: string; error: string | null; created: number; replied: number };

function origin() {
  try {
    const u = new URL(env("PUBLIC_APP_ORIGIN"));
    return u.protocol === "https:" && !u.username ? u.origin : "";
  } catch {
    return "";
  }
}
export const redirectUri = () => origin() + "/api/public/google/callback";

export function missingConfig() {
  const missing: string[] = [];
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(env("GOOGLE_CLIENT_ID")))
    missing.push("GOOGLE_CLIENT_ID");
  if (env("GOOGLE_CLIENT_SECRET").length < 10) missing.push("GOOGLE_CLIENT_SECRET");
  if (!origin()) missing.push("PUBLIC_APP_ORIGIN");
  return missing;
}

/* ---------- small key/value store in the service-only outbox table ---------- */
async function getValue<T>(key: string): Promise<T | null> {
  const db = await admin();
  const { data } = await db.from("outbox").select("status").eq("key", key).maybeSingle();
  if (!data?.status) return null;
  try {
    return JSON.parse(await decrypt(data.status)) as T;
  } catch {
    return null;
  }
}
async function putValue(key: string, type: string, value: unknown) {
  const db = await admin();
  const { error } = await db
    .from("outbox")
    .upsert(
      { key, type, ticket_id: NIL, status: await encrypt(JSON.stringify(value)) },
      { onConflict: "key" },
    );
  rpcError(error);
}
async function dropValue(key: string) {
  const db = await admin();
  await db.from("outbox").delete().eq("key", key);
}

export async function googleRules(): Promise<GoogleRules> {
  const db = await admin();
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "google_reviews")
    .maybeSingle();
  return readRules(data?.value);
}

/* ---------------------------- connecting ---------------------------- */
function superOnly(a: Actor) {
  if (a.role !== "SUPER_ADMIN") throw new DomainError("FORBIDDEN", 403, "متاح لمدير النظام فقط");
}

export async function beginConnect(a: Actor) {
  superOnly(a);
  const missing = missingConfig();
  if (missing.length)
    throw new DomainError(
      "GOOGLE_NOT_CONFIGURED",
      400,
      "أكمل إعدادات Google أولاً: " + missing.join("، "),
    );
  const state = randomToken();
  await putValue("ggstate:" + (await keyedHash("ggstate:" + state)), "GOOGLE_STATE", {
    userId: a.id,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  const q = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return { url: "https://accounts.google.com/o/oauth2/v2/auth?" + q.toString() };
}

/** Google's redirect after the admin allows access. Returns where to send the browser. */
export async function finishConnect(code: string, state: string, fetcher: typeof fetch = fetch) {
  const back = (result: string) => "/?view=settings&google=" + result;
  if (!code || !state || state.length > 100) return back("failed");
  const key = "ggstate:" + (await keyedHash("ggstate:" + state));
  const saved = await getValue<{ userId: string; expiresAt: string }>(key);
  await dropValue(key);
  if (!saved || +new Date(saved.expiresAt) < Date.now()) return back("expired");
  const res = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const out = (await res.json().catch(() => ({}))) as { refresh_token?: string; scope?: string };
  if (!res.ok || !out.refresh_token || !String(out.scope ?? "").includes(SCOPE))
    return back("failed");
  await putValue(TOKEN_KEY, "GOOGLE_TOKEN", {
    refresh: out.refresh_token,
    connectedAt: new Date().toISOString(),
    by: saved.userId,
  } satisfies Token);
  cached = null;
  const db = await admin();
  await db.rpc("write_audit", {
    _actor: saved.userId,
    _action: "GOOGLE_CONNECTED",
    _entity: "google",
  });
  return back("connected");
}

export async function disconnect(a: Actor) {
  superOnly(a);
  await dropValue(TOKEN_KEY);
  cached = null;
  const db = await admin();
  await db.rpc("write_audit", { _actor: a.id, _action: "GOOGLE_DISCONNECTED", _entity: "google" });
  return { ok: true };
}

/* ---------------------------- Google API ---------------------------- */
let cached: { token: string; until: number } | null = null;

async function accessToken(fetcher: typeof fetch) {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const t = await getValue<Token>(TOKEN_KEY);
  if (!t) throw new DomainError("GOOGLE_NOT_CONNECTED", 400, "حساب Google غير مربوط");
  const res = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: t.refresh,
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
    }),
  });
  const out = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !out.access_token) {
    throw new DomainError(
      "GOOGLE_AUTH",
      400,
      out.error === "invalid_grant"
        ? "انتهت صلاحية ربط Google؛ أعد الربط من الإعدادات"
        : "تعذر الاتصال بحساب Google",
    );
  }
  cached = { token: out.access_token, until: Date.now() + (out.expires_in ?? 3000) * 1000 };
  return cached.token;
}

async function gFetch<T>(
  url: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const token = await accessToken(fetcher);
  const res = await fetcher(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (res.ok) return (res.status === 204 ? {} : await res.json()) as T;
  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; status?: string };
  };
  const why = body.error?.status ?? String(res.status);
  if (res.status === 403 || res.status === 429)
    throw new DomainError(
      "GOOGLE_API",
      400,
      `Google رفض الطلب (${why}). تأكد أن واجهة Business Profile مفعلة ومعتمدة لمشروع Google Cloud.`,
    );
  throw new DomainError("GOOGLE_API", 400, `خطأ من Google (${why})`);
}

type GLocation = {
  name: string;
  title?: string;
  storefrontAddress?: { addressLines?: string[]; locality?: string };
};

/** All Google locations the connected account manages, with the branch each is linked to. */
export async function listLocations(a: Actor, fetcher: typeof fetch = fetch) {
  superOnly(a);
  const accounts = await gFetch<{ accounts?: { name: string; accountName?: string }[] }>(
    ACCOUNTS,
    {},
    fetcher,
  );
  const out: { location: string; title: string; address: string; account: string }[] = [];
  for (const acc of accounts.accounts ?? []) {
    let pageToken = "";
    do {
      const q = new URLSearchParams({
        readMask: "name,title,storefrontAddress",
        pageSize: "100",
        ...(pageToken ? { pageToken } : {}),
      });
      const page = await gFetch<{ locations?: GLocation[]; nextPageToken?: string }>(
        `${INFO}/${acc.name}/locations?${q}`,
        {},
        fetcher,
      );
      for (const l of page.locations ?? []) {
        out.push({
          // Reviews live under accounts/{a}/locations/{l}.
          location: `${acc.name}/${l.name}`,
          title: l.title ?? l.name,
          address: [
            ...(l.storefrontAddress?.addressLines ?? []),
            l.storefrontAddress?.locality ?? "",
          ]
            .filter(Boolean)
            .join("، "),
          account: acc.accountName ?? acc.name,
        });
      }
      pageToken = page.nextPageToken ?? "";
    } while (pageToken);
  }
  const db = await admin();
  const { data: branches } = await db
    .from("branches")
    .select("id,google_location")
    .not("google_location", "is", null);
  const linked = new Map((branches ?? []).map((b) => [b.google_location, b.id]));
  return out.map((l) => ({ ...l, branchId: linked.get(l.location) ?? null }));
}

export async function linkLocation(a: Actor, branchId: string, location: string | null) {
  superOnly(a);
  if (location && !/^accounts\/\d+\/locations\/\d+$/.test(location))
    throw new DomainError("INVALID_LOCATION", 400, "موقع Google غير صالح");
  const db = await admin();
  if (location)
    await db.from("branches").update({ google_location: null }).eq("google_location", location);
  const { error } = await db
    .from("branches")
    .update({ google_location: location })
    .eq("id", branchId);
  rpcError(error);
  await db.rpc("write_audit", {
    _actor: a.id,
    _action: location ? "GOOGLE_LOCATION_LINKED" : "GOOGLE_LOCATION_UNLINKED",
    _entity: branchId,
  });
  return { ok: true };
}

/* ------------------------------ replies ------------------------------ */
async function aiDraft(
  r: { stars: Stars; comment: string; brand: string; branch: string },
  fetcher: typeof fetch,
) {
  if (!env("LOVABLE_API_KEY")) return null;
  try {
    const res = await fetcher(AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("LOVABLE_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: AI_MODEL, messages: aiMessages(r) }),
    });
    if (!res.ok) return null;
    const out = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = cleanAi(out.choices?.[0]?.message?.content ?? "");
    return text.length >= 10 ? text : null;
  } catch {
    return null;
  }
}

/** The reply text for a review under a rule; AI falls back to the script. */
async function composeReply(
  rule: StarRule,
  r: { stars: Stars; comment: string; reviewer: string; brand: string; branch: string },
  fetcher: typeof fetch,
) {
  const facts = { reviewer: r.reviewer, brand: r.brand, branch: r.branch };
  if (rule.mode === "ai") {
    const draft = await aiDraft(r, fetcher);
    if (draft) return { text: fillScript(draft, facts), source: "AI" as const };
  }
  return { text: fillScript(rule.text, facts), source: "SCRIPT" as const };
}

async function postReply(reviewId: string, text: string, fetcher: typeof fetch) {
  await gFetch(
    `${REVIEWS}/${reviewId}/reply`,
    { method: "PUT", body: JSON.stringify({ comment: text }) },
    fetcher,
  );
}

/* ------------------------------ complaints ------------------------------ */
async function createComplaint(
  rv: { id: string; stars: Stars; comment: string; reviewer: string; createdAt: string },
  branch: { id: string; brand_id: string; name: string },
  brandName: string,
  priority: "P2" | "P3",
) {
  const db = await admin();
  const policy = (await settings()).sla;
  const { data: seq, error: seqErr } = await db.rpc("next_ticket_sequence");
  rpcError(seqErr);
  const received = new Date(Math.max(+new Date(rv.createdAt), Date.now() - 29 * 86400000));
  const number = ticketNumber(Number(seq), new Date());
  const description = `تقييم Google: ${"★".repeat(rv.stars)}${"☆".repeat(5 - rv.stars)} (${rv.stars} من 5)\n\n${rv.comment.trim() || "(بدون نص)"}`;
  const receipt = {
    number,
    brand: brandName,
    branch: branch.name,
    receivedAt: received.toISOString(),
    category: "تقييم Google",
    description,
    customerName: rv.reviewer,
    externalOrder: "",
    platform: "",
    source: "Google",
    trackingPath: "",
  };
  const { data, error } = await db.rpc("create_ticket_tx", {
    p: {
      idem_key: "google:" + rv.id,
      request_hash: await sha256(rv.id),
      sequence: seq,
      brand_id: branch.brand_id,
      branch_id: branch.id,
      unknown_reason: null,
      source: "GOOGLE_REVIEW",
      category: "OTHER",
      priority,
      description_enc: await encrypt(description),
      receipt_enc: await encrypt(JSON.stringify(receipt)),
      customer_enc: await encrypt(JSON.stringify({ name: rv.reviewer, phone: "" })),
      phone_hash: null,
      external_order: null,
      platform: null,
      communications_owner: "UNASSIGNED",
      creator: "GOOGLE_REVIEW",
      received_at: received.toISOString(),
      sla_policy: policy,
      actor: "GOOGLE_REVIEW",
      event_type: "GOOGLE_REVIEW_CREATED",
      timers: slaMilestones(priority, received, policy),
      access_hash: null,
      response_enc: await encrypt("{}"),
    } as never,
  });
  rpcError(error);
  const out = data as { replay: boolean; id?: string };
  if (out.replay || !out.id) return null;
  const who = await (await import("./assign.server")).autoAssign(out.id);
  const tg = await import("./telegram.server");
  if (who) await tg.notifyAssigned(out.id, who);
  await tg.notifyNewComplaint(out.id);
  return out.id;
}

/* -------------------------------- sync -------------------------------- */
type GReview = {
  name: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating?: string;
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: { comment?: string; updateTime?: string };
};

/** Google appends "(Translated by Google)" blocks; keep the reviewer's own words. */
const ownWords = (c = "") => c.split(/\n\n\(Translated by Google\)|\(Original\)\n/)[0]!.trim();

export async function syncReviews(fetcher: typeof fetch = fetch, now = new Date()) {
  const token = await getValue<Token>(TOKEN_KEY);
  if (!token || missingConfig().length) return { skipped: "not_connected" as const };
  const rules = await googleRules();
  const db = await admin();
  const { data: branches } = await db
    .from("branches")
    .select("id,brand_id,name,google_location")
    .not("google_location", "is", null);
  if (!branches?.length) return { skipped: "no_locations" as const };
  const { data: brands } = await db.from("brands").select("id,name");
  const brandName = (id: string) => brands?.find((b) => b.id === id)?.name ?? "";
  const last = await getValue<SyncState>(SYNC_KEY);
  // Look back a little before the last run so nothing slips between runs.
  const since = last ? +new Date(last.at) - 15 * 60_000 : 0;
  let created = 0,
    replied = 0;
  let error: string | null = null;

  for (const b of branches) {
    try {
      let pageToken = "";
      let older = false;
      do {
        const q = new URLSearchParams({
          pageSize: "50",
          orderBy: "updateTime desc",
          ...(pageToken ? { pageToken } : {}),
        });
        const page = await gFetch<{ reviews?: GReview[]; nextPageToken?: string }>(
          `${REVIEWS}/${b.google_location}/reviews?${q}`,
          {},
          fetcher,
        );
        for (const g of page.reviews ?? []) {
          if (since && +new Date(g.updateTime) < since) {
            older = true;
            break;
          }
          const stars = starsOf(g.starRating);
          if (!stars) continue;
          const reviewer = g.reviewer?.isAnonymous ? "" : (g.reviewer?.displayName ?? "");
          const comment = ownWords(g.comment);
          const hasReply = !!g.reviewReply?.comment;
          const { data: existing } = await db
            .from("google_reviews")
            .select("id,reply_state,ticket_id")
            .eq("id", g.name)
            .maybeSingle();
          const row = {
            location: b.google_location!,
            branch_id: b.id,
            brand_id: b.brand_id,
            rating: stars,
            reviewer_enc: reviewer ? await encrypt(reviewer) : null,
            comment_enc: comment ? await encrypt(comment) : null,
            created_at: g.createTime,
            updated_at: g.updateTime,
            synced_at: now.toISOString(),
          };
          if (existing) {
            // Edited on Google, or answered there by someone outside the CRM.
            const patch: Record<string, unknown> = { ...row };
            if (hasReply && existing.reply_state !== "SENT")
              Object.assign(patch, {
                reply_state: "SENT",
                reply_source: "GOOGLE",
                reply_enc: await encrypt(g.reviewReply!.comment!),
              });
            await db
              .from("google_reviews")
              .update(patch as never)
              .eq("id", g.name);
            continue;
          }
          const d = decide({ stars, createdAt: g.createTime, hasReply }, rules, token.connectedAt);
          // Insert first: if another run got here first, the insert fails and nothing is done twice.
          const { error: insErr } = await db.from("google_reviews").insert({
            id: g.name,
            ...row,
            reply_state: hasReply ? "SENT" : d.history ? "HISTORY" : "NONE",
            reply_source: hasReply ? "GOOGLE" : null,
            reply_enc: hasReply ? await encrypt(g.reviewReply!.comment!) : null,
          });
          if (insErr) continue;
          const facts = { stars, comment, reviewer, brand: brandName(b.brand_id), branch: b.name };
          if (d.complaint) {
            const ticketId = await createComplaint(
              { id: g.name, stars, comment, reviewer, createdAt: g.createTime },
              b,
              facts.brand,
              d.priority,
            );
            if (ticketId) {
              created++;
              await db.from("google_reviews").update({ ticket_id: ticketId }).eq("id", g.name);
            }
          }
          if (d.reply) {
            const { text, source } = await composeReply(d.reply, facts, fetcher);
            if (d.reply.send === "auto") {
              try {
                await postReply(g.name, text, fetcher);
                replied++;
                await db
                  .from("google_reviews")
                  .update({
                    reply_state: "SENT",
                    reply_source: source,
                    reply_enc: await encrypt(text),
                    replied_at: new Date().toISOString(),
                    replied_by: "AUTO",
                  })
                  .eq("id", g.name);
              } catch {
                await db
                  .from("google_reviews")
                  .update({
                    reply_state: "FAILED",
                    reply_source: source,
                    reply_enc: await encrypt(text),
                  })
                  .eq("id", g.name);
              }
            } else {
              await db
                .from("google_reviews")
                .update({
                  reply_state: "DRAFT",
                  reply_source: source,
                  reply_enc: await encrypt(text),
                })
                .eq("id", g.name);
            }
          }
        }
        pageToken = older ? "" : (page.nextPageToken ?? "");
      } while (pageToken);
    } catch (e) {
      error = (e as Error).message.slice(0, 200);
    }
  }
  await putValue(SYNC_KEY, "GOOGLE_SYNC", {
    at: now.toISOString(),
    error,
    created,
    replied,
  } satisfies SyncState);
  return { created, replied, error };
}

/* ------------------------- staff: reviews list ------------------------- */
type ReviewRow = {
  id: string;
  branch_id: string | null;
  brand_id: string | null;
  rating: number;
  reviewer_enc: string | null;
  comment_enc: string | null;
  created_at: string;
  reply_enc: string | null;
  reply_state: string;
  reply_source: string | null;
  replied_at: string | null;
  ticket_id: string | null;
};
const COLUMNS =
  "id,branch_id,brand_id,rating,reviewer_enc,comment_enc,created_at,reply_enc,reply_state,reply_source,replied_at,ticket_id";

async function present(r: ReviewRow, numbers: Map<string, string>) {
  return {
    id: r.id,
    branchId: r.branch_id,
    brandId: r.brand_id,
    rating: r.rating,
    reviewer: r.reviewer_enc ? await decrypt(r.reviewer_enc) : "",
    comment: r.comment_enc ? await decrypt(r.comment_enc) : "",
    createdAt: r.created_at,
    reply: r.reply_enc ? await decrypt(r.reply_enc) : "",
    replyState: r.reply_state,
    replySource: r.reply_source,
    repliedAt: r.replied_at,
    ticketId: r.ticket_id,
    ticketNumber: r.ticket_id ? (numbers.get(r.ticket_id) ?? null) : null,
  };
}
export type PresentedReview = Awaited<ReturnType<typeof present>>;

function canReply(a: Actor) {
  return can(a, "contact") || a.role === "SUPER_ADMIN";
}

export async function listReviews(
  a: Actor,
  f: { filter: "pending" | "unanswered" | "all"; brandId?: string | undefined; limit: number },
) {
  if (!canReply(a) && !can(a, "read")) throw new DomainError("FORBIDDEN", 403, "غير مصرح");
  const db = await admin();
  let q = db
    .from("google_reviews")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(f.limit);
  if (f.filter === "pending") q = q.eq("reply_state", "DRAFT");
  if (f.filter === "unanswered") q = q.in("reply_state", ["NONE", "FAILED", "DRAFT"]);
  if (f.brandId) q = q.eq("brand_id", f.brandId);
  const { data, error } = await q;
  rpcError(error);
  const rows = ((data ?? []) as ReviewRow[]).filter((r) =>
    r.brand_id
      ? inScope(a, { brandId: r.brand_id, branchId: r.branch_id })
      : a.role === "SUPER_ADMIN",
  );
  const ids = rows.map((r) => r.ticket_id).filter(Boolean) as string[];
  const { data: tickets } = ids.length
    ? await db.from("tickets").select("id,sequence,created_at").in("id", ids)
    : { data: [] as { id: string; sequence: number; created_at: string }[] };
  const numbers = new Map(
    (tickets ?? []).map((t) => [t.id, ticketNumber(t.sequence, new Date(t.created_at))]),
  );
  const { count } = await db
    .from("google_reviews")
    .select("id", { count: "exact", head: true })
    .eq("reply_state", "DRAFT");
  return { reviews: await Promise.all(rows.map((r) => present(r, numbers))), pending: count ?? 0 };
}

async function loadScoped(a: Actor, id: string) {
  if (!canReply(a))
    throw new DomainError("FORBIDDEN", 403, "الرد على التقييمات متاح لفريق خدمة العملاء");
  const db = await admin();
  const { data } = await db.from("google_reviews").select(COLUMNS).eq("id", id).maybeSingle();
  const r = data as ReviewRow | null;
  if (
    !r ||
    (r.brand_id
      ? !inScope(a, { brandId: r.brand_id, branchId: r.branch_id })
      : a.role !== "SUPER_ADMIN")
  )
    throw new DomainError("NOT_FOUND", 404, "التقييم غير موجود ضمن نطاقك");
  return r;
}

/** A staff member sends (or edits) the public reply. */
export async function replyReview(
  a: Actor,
  id: string,
  text: string,
  fetcher: typeof fetch = fetch,
) {
  const r = await loadScoped(a, id);
  const comment = text.trim().slice(0, MAX_REPLY);
  if (comment.length < 2) throw new DomainError("REPLY_REQUIRED", 400, "اكتب نص الرد");
  await postReply(r.id, comment, fetcher);
  const db = await admin();
  const draft = r.reply_enc ? await decrypt(r.reply_enc) : "";
  await db
    .from("google_reviews")
    .update({
      reply_state: "SENT",
      // Approving an automatic draft unchanged keeps its source.
      reply_source: draft === comment && r.reply_source ? r.reply_source : "STAFF",
      reply_enc: await encrypt(comment),
      replied_at: new Date().toISOString(),
      replied_by: a.id,
    })
    .eq("id", r.id);
  if (r.ticket_id)
    await db
      .from("ticket_events")
      .insert({ ticket_id: r.ticket_id, type: "GOOGLE_REPLIED", actor: a.id });
  await db.rpc("write_audit", { _actor: a.id, _action: "GOOGLE_REVIEW_REPLIED", _entity: r.id });
  return { ok: true };
}

/** A fresh suggestion from the AI (or the script when AI is unavailable). */
export async function suggestReply(a: Actor, id: string, fetcher: typeof fetch = fetch) {
  const r = await loadScoped(a, id);
  const db = await admin();
  const [{ data: brand }, { data: branch }] = await Promise.all([
    db
      .from("brands")
      .select("name")
      .eq("id", r.brand_id ?? "")
      .maybeSingle(),
    db
      .from("branches")
      .select("name")
      .eq("id", r.branch_id ?? NIL)
      .maybeSingle(),
  ]);
  const rules = await googleRules();
  const stars = (starsOf(r.rating) ?? 3) as Stars;
  const reply = await composeReply(
    { ...rules.rules[stars], mode: "ai" },
    {
      stars,
      comment: r.comment_enc ? await decrypt(r.comment_enc) : "",
      reviewer: r.reviewer_enc ? await decrypt(r.reviewer_enc) : "",
      brand: brand?.name ?? "",
      branch: branch?.name ?? "",
    },
    fetcher,
  );
  return reply;
}

/** The Google review behind a complaint, for the complaint details. */
export async function reviewForTicket(ticketId: string) {
  const db = await admin();
  const { data } = await db
    .from("google_reviews")
    .select(COLUMNS)
    .eq("ticket_id", ticketId)
    .maybeSingle();
  return data ? present(data as ReviewRow, new Map()) : null;
}

/* ------------------------------- status ------------------------------- */
export async function status(a: Actor) {
  superOnly(a);
  const db = await admin();
  const [token, sync, rules, { data: linked }, { data: states }] = await Promise.all([
    getValue<Token>(TOKEN_KEY),
    getValue<SyncState>(SYNC_KEY),
    googleRules(),
    db.from("branches").select("id").not("google_location", "is", null),
    db.from("google_reviews").select("reply_state"),
  ]);
  const counts: Record<string, number> = {};
  for (const s of states ?? []) counts[s.reply_state] = (counts[s.reply_state] ?? 0) + 1;
  return {
    missing: missingConfig(),
    redirectUri: origin() ? redirectUri() : "",
    connected: !!token,
    connectedAt: token?.connectedAt ?? null,
    lastSync: sync?.at ?? null,
    lastError: sync?.error ?? null,
    linkedBranches: linked?.length ?? 0,
    counts,
    aiAvailable: !!env("LOVABLE_API_KEY"),
    rules,
  };
}

export async function saveRules(a: Actor, rules: GoogleRules) {
  superOnly(a);
  const clean = readRules(rules);
  const db = await admin();
  const { error } = await db
    .from("app_settings")
    .upsert({ key: "google_reviews", value: clean as never, updated_at: new Date().toISOString() });
  rpcError(error);
  await db.rpc("write_audit", {
    _actor: a.id,
    _action: "GOOGLE_RULES_UPDATED",
    _entity: "google_reviews",
  });
  return clean;
}
