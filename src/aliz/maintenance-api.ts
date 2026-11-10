// The Maintenance app's calls to the server. Kept apart from the complaint
// adapter: these are new screens, so they call the server functions directly.
import {
  maintenanceAction,
  maintenanceBoard,
  maintenanceCreate,
  maintenanceDetail,
  maintenancePhoto,
  maintenanceReport,
  maintenancePhotoLink,
  maintenanceSaveSettings,
} from "@/functions/maintenance.functions";
import type {
  MaintenanceAction,
  MaintenancePriority,
  MaintenanceRequest,
  MaintenanceSettings,
} from "@/lib/maintenance";
import { prepareImage } from "./prepare-image";

export type MaintenancePerson = {
  id: string;
  name: string;
  role: string;
  brandIds: string[];
  branchIds: string[];
};
export type MaintenanceBoard = {
  requests: MaintenanceRequest[];
  people: MaintenancePerson[];
  settings: MaintenanceSettings;
};
export type MaintenanceDetail = {
  request: MaintenanceRequest;
  events: { id: string; type: string; actor: string; note: string | null; createdAt: string }[];
  photos: { id: string; stage: "BEFORE" | "AFTER"; createdAt: string }[];
};

const message = (e: unknown) => {
  const m = (e as Error)?.message ?? "";
  // Validation errors arrive as JSON lists; show the first message only.
  try {
    const list = JSON.parse(m) as { message?: string }[];
    if (Array.isArray(list) && list[0]?.message) return list[0].message;
  } catch {
    /* plain message */
  }
  return m || "تعذر إكمال الطلب";
};
async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    throw new Error(message(e));
  }
}

const toBase64 = async (file: Blob) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

export const maintenanceApi = {
  board: (status: "open" | "closed" | "all") =>
    call(() => maintenanceBoard({ data: { status } }) as Promise<MaintenanceBoard>),
  detail: (id: string) =>
    call(() => maintenanceDetail({ data: { id } }) as Promise<MaintenanceDetail>),
  create: (input: {
    branchId: string;
    category: string;
    categoryDetail: string;
    priority: MaintenancePriority;
    title: string;
    description: string;
  }) => call(() => maintenanceCreate({ data: input })),
  act: (input: {
    id: string;
    version: number;
    action: MaintenanceAction;
    assignee?: string;
    note?: string;
  }) => call(() => maintenanceAction({ data: { note: "", ...input } })),
  photos: async (id: string, stage: "BEFORE" | "AFTER", files: File[]) => {
    for (const f of files) {
      const base64 = await toBase64(await prepareImage(f));
      await call(() => maintenancePhoto({ data: { id, stage, base64 } }));
    }
  },
  photoUrl: (id: string) => call(() => maintenancePhotoLink({ data: { id } })).then((r) => r.url),
  report: (input: {
    from: string;
    to: string;
    brandId?: string;
    branchId?: string;
    csv?: boolean;
  }) =>
    call(
      () =>
        maintenanceReport({ data: { csv: false, ...input } }) as Promise<{
          requests: MaintenanceRequest[];
          csv: string | null;
        }>,
    ),
  saveSettings: (s: MaintenanceSettings) =>
    call(() => maintenanceSaveSettings({ data: s }) as Promise<MaintenanceSettings>),
};
