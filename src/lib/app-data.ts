import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getBootstrap } from "@/server/complaints.functions";

export const bootstrapQuery = queryOptions({ queryKey: ["bootstrap"], queryFn: () => getBootstrap(), staleTime: 30_000 });

export type Bootstrap = Awaited<ReturnType<typeof getBootstrap>>;
export type ReadyBootstrap = Extract<Bootstrap, { status: "OK" }>;

export function useApp() {
  const { data } = useSuspenseQuery(bootstrapQuery);
  if (data.status !== "OK") throw new Error("NOT_READY");
  const d = data as ReadyBootstrap;
  const has = (p: string) => d.permissions.includes(p);
  const brandName = (id: string) => d.brands.find((b) => b.id === id)?.name ?? id;
  const branchName = (id: string | null) => (id ? d.branches.find((b) => b.id === id)?.name ?? "فرع خارج النطاق" : "غير محدد");
  const staffName = (id: string | null) =>
    !id ? "—" : id === "UNASSIGNED" ? "غير مسند" : id === "PUBLIC_QR" ? "العميل عبر QR" : d.staff.find((s) => s.id === id)?.name ?? "موظف";
  return { ...d, has, brandName, branchName, staffName };
}

export function errMessage(e: unknown) {
  if (e instanceof Error) {
    try {
      const parsed = JSON.parse(e.message);
      if (Array.isArray(parsed) && parsed[0]?.message) return parsed[0].message as string;
    } catch { /* plain message */ }
    return e.message;
  }
  return "حدث خطأ";
}
export const idemKey = () => crypto.randomUUID();
