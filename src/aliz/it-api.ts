// The IT app's calls to the server (direct server functions, like Maintenance).
import {
  itAction,
  itBoard,
  itCreate,
  itDetail,
  itPhoto,
  itPhotoLink,
  itReport,
  itSaveSettings,
} from "@/functions/it.functions";
import type { ItAction, ItPriority, ItSettings, ItTicket } from "@/lib/it";
import { prepareImage } from "./prepare-image";

export type ItPerson = { id: string; name: string; role: string };
export type ItBoard = { tickets: ItTicket[]; people: ItPerson[]; settings: ItSettings };
export type ItDetail = {
  ticket: ItTicket;
  events: { id: string; type: string; actor: string; note: string | null; createdAt: string }[];
  photos: { id: string; stage: "BEFORE" | "AFTER"; createdAt: string }[];
};

const message = (e: unknown) => {
  const m = (e as Error)?.message ?? "";
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

export const itApi = {
  board: (status: "open" | "closed" | "all") =>
    call(() => itBoard({ data: { status } }) as Promise<ItBoard>),
  detail: (id: string) => call(() => itDetail({ data: { id } }) as Promise<ItDetail>),
  create: (input: {
    department: string;
    branchId: string;
    category: string;
    categoryDetail: string;
    priority: ItPriority;
    title: string;
    description: string;
  }) => call(() => itCreate({ data: input })),
  act: (input: {
    id: string;
    version: number;
    action: ItAction;
    assignee?: string;
    note?: string;
  }) => call(() => itAction({ data: { note: "", ...input } })),
  photos: async (id: string, stage: "BEFORE" | "AFTER", files: File[]) => {
    for (const f of files) {
      const base64 = await toBase64(await prepareImage(f));
      await call(() => itPhoto({ data: { id, stage, base64 } }));
    }
  },
  photoUrl: (id: string) => call(() => itPhotoLink({ data: { id } })).then((r) => r.url),
  report: (input: {
    from: string;
    to: string;
    department?: string;
    branchId?: string;
    csv?: boolean;
  }) =>
    call(
      () =>
        itReport({ data: { csv: false, ...input } }) as Promise<{
          tickets: ItTicket[];
          names: Record<string, string>;
          csv: string | null;
        }>,
    ),
  saveSettings: (s: ItSettings) => call(() => itSaveSettings({ data: s }) as Promise<ItSettings>),
};
