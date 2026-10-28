import { beforeEach, describe, expect, it, vi } from "vitest";

// The original screens talk to src/aliz/adapter.ts by REST-style path. These
// tests fake the server functions and the RLS-scoped Supabase reads, and check
// that the adapter returns the shapes the screens were written for.

const fn = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  searchComplaints: vi.fn(),
  getComplaint: vi.fn(),
  createPhoneComplaint: vi.fn(),
  complaintAction: vi.fn(),
  listRefunds: vi.fn(),
  refundAction: vi.fn(),
  requestRefund: vi.fn(),
  listShifts: vi.fn(),
  updateSetting: vi.fn(),
  publicQrInfo: vi.fn(),
  publicCreate: vi.fn(),
  trackStatus: vi.fn(),
  rows: {} as Record<string, unknown[]>,
  session: { access_token: "t" } as unknown,
}));

vi.mock("@/functions/complaints.functions", () => ({
  getBootstrap: fn.getBootstrap,
  searchComplaints: fn.searchComplaints,
  getComplaint: fn.getComplaint,
  createPhoneComplaint: fn.createPhoneComplaint,
  complaintAction: fn.complaintAction,
}));
vi.mock("@/functions/refunds.functions", () => ({
  listRefunds: fn.listRefunds,
  refundAction: fn.refundAction,
  requestRefund: fn.requestRefund,
}));
vi.mock("@/functions/admin.functions", () => ({
  listShifts: fn.listShifts,
  updateSetting: fn.updateSetting,
  cancelShift: vi.fn(),
  createStaff: vi.fn(),
  evidenceLink: vi.fn(),
  listQrs: vi.fn(),
  listStaff: vi.fn(),
  qrForBranch: vi.fn(),
  retireQr: vi.fn(),
  runReport: vi.fn(),
  saveBranch: vi.fn(),
  saveShifts: vi.fn(),
  setBranchActive: vi.fn(),
  updateBrand: vi.fn(),
  updateStaff: vi.fn(),
  uploadEvidence: vi.fn(),
}));
vi.mock("@/functions/public.functions", () => ({
  publicQrInfo: fn.publicQrInfo,
  publicCreate: fn.publicCreate,
  trackStatus: fn.trackStatus,
}));
vi.mock("@/integrations/supabase/client", () => {
  const query = (table: string) => {
    const q = {
      select: () => q,
      in: () => q,
      gte: () => q,
      lt: () => q,
      eq: () => q,
      order: () => q,
      range: () => Promise.resolve({ data: fn.rows[table] ?? [], error: null }),
      then: (ok: (v: unknown) => unknown) =>
        Promise.resolve({ data: fn.rows[table] ?? [], error: null }).then(ok),
    };
    return q;
  };
  return {
    supabase: {
      from: query,
      auth: {
        getSession: () => Promise.resolve({ data: { session: fn.session } }),
        signInWithPassword: vi.fn(() => Promise.resolve({ error: null })),
        signOut: vi.fn(() => Promise.resolve({})),
      },
    },
  };
});

import { AccessError, api } from "@/aliz/adapter";
import { risk, type Data, type Ticket } from "@/aliz/types";

const me = {
  id: "u1",
  name: "قائد",
  role: "SHIFT_LEAD",
  brandIds: ["waqf"],
  branchIds: [],
  financeDuty: "NONE",
};
const okBoot = {
  status: "OK",
  email: "lead@example.invalid",
  me,
  permissions: ["read", "assign", "pii"],
  brands: [
    {
      id: "waqf",
      name: "واقف",
      name_en: "Burger Waqf",
      logo: "waqf",
      color: "#B62E30",
      status: "ACTIVE",
    },
  ],
  branches: [
    { id: "b1", brand_id: "waqf", name: "فرع أ", city: "الرياض", code: "W1", active: true },
  ],
  staff: [me],
  flags: {
    publicIntake: false,
    financeApproved: false,
    financeLimitMinor: null,
    slaVersion: "SLA-1",
    slaApproved: true,
    whatsapp: false,
    telegram: false,
  },
};
const listTicket = {
  id: "t1",
  number: "AG-2026-000001",
  brandId: "waqf",
  branchId: "b1",
  state: "NEW",
  priority: "P2",
  category: "DELAY",
  source: "PHONE_AGENT",
  creator: "u1",
  communicationsOwner: "u1",
  resolutionOwner: null,
  receivedAt: "2026-10-28T08:00:00Z",
  createdAt: "2026-10-28T08:00:00Z",
  version: 1,
  escalated: false,
  description: null,
  customer: null,
  branchBrief: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  fn.rows = {};
  fn.session = { access_token: "t" };
  fn.getBootstrap.mockResolvedValue(okBoot);
  fn.searchComplaints.mockResolvedValue({ tickets: [listTicket], total: 1, nextOffset: null });
  fn.listRefunds.mockResolvedValue([]);
  fn.listShifts.mockResolvedValue([]);
});

describe("bootstrap", () => {
  it("builds the original workspace data from the server functions", async () => {
    fn.rows["ticket_timers"] = [
      {
        ticket_id: "t1",
        milestone: "FIRST_ACTION",
        due_at: "2000-01-01T00:00:00Z",
        warning_at: "2000-01-01T00:00:00Z",
        completed_at: null,
        breached_at: null,
      },
    ];
    const data = await api<Data>("bootstrap");
    expect(data.me.role).toBe("SHIFT_LEAD");
    expect(data.brands[0]?.logo).toBe("waqf.jpeg");
    expect(data.brands[0]?.branches.map((b) => b.id)).toEqual(["b1"]);
    expect(data.policy).toEqual({ sla: "SLA-1", finance: false, publicIntake: false });
    const t = data.tickets[0] as Ticket;
    expect(t.brand.name).toBe("واقف");
    expect(t.branch?.name).toBe("فرع أ");
    // Deadline timers come through, so overdue cases show as overdue.
    expect(risk(t)).toBe("late");
  });

  it("asks for two-factor, a role or reactivation instead of showing data", async () => {
    for (const status of ["MFA_REQUIRED", "NO_ACCESS", "DISABLED"] as const) {
      fn.getBootstrap.mockResolvedValueOnce({ status, email: "x", me: null });
      const error = await api("bootstrap").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AccessError);
      expect((error as AccessError).code).toBe(status);
    }
  });

  it("shows the sign-in screen when there is no session", async () => {
    fn.session = null;
    await expect(api("bootstrap")).rejects.toThrow("يرجى تسجيل الدخول");
    expect(fn.getBootstrap).not.toHaveBeenCalled();
  });
});

describe("complaint actions", () => {
  it("maps the original action names and sends the case version", async () => {
    fn.complaintAction.mockResolvedValue({ ok: true });
    await api("tickets/t1/actions/acknowledge", { version: 3, note: "تم الاستلام" });
    expect(fn.complaintAction).toHaveBeenCalledWith({
      data: {
        id: "t1",
        action: "start",
        input: expect.objectContaining({ version: 3, note: "تم الاستلام" }),
      },
    });
  });
});

describe("public pages", () => {
  it("shows the QR branch and tracking receipt without staff data", async () => {
    fn.publicQrInfo.mockResolvedValue({
      ok: true,
      brandName: "واقف",
      branchName: "فرع أ",
      logo: "waqf",
    });
    await expect(api("public/q/abcdefghijklmnop")).resolves.toMatchObject({
      brand: "واقف",
      logo: "waqf.jpeg",
    });
    fn.trackStatus.mockResolvedValue({ ok: false, message: "رابط المتابعة غير صالح أو منتهي" });
    await expect(api("public/status/abcdefghijklmnop")).rejects.toThrow("رابط المتابعة غير صالح");
  });
});

describe("unbuilt features", () => {
  it("fail with a clear message rather than pretending to work", async () => {
    await expect(api("tasks", { ticketId: "t1" })).rejects.toThrow("غير مفعلة بعد");
    await expect(api("leave", {})).rejects.toThrow("غير مفعلة بعد");
  });
});

describe("settings", () => {
  it("switches customer QR intake through the audited server setting", async () => {
    fn.updateSetting.mockResolvedValue({ ok: true });
    await api("settings/public-intake", { enabled: true });
    expect(fn.updateSetting).toHaveBeenCalledWith({
      data: { key: "public_intake_enabled", value: true },
    });
    await api("settings/public-intake", { enabled: false });
    expect(fn.updateSetting).toHaveBeenLastCalledWith({
      data: { key: "public_intake_enabled", value: false },
    });
  });
});
