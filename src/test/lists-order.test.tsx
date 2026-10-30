import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const saved = vi.hoisted(() => ({ body: null as unknown }));
vi.mock("@/aliz/adapter", () => ({
  api: async (_path: string, body: unknown) => {
    saved.body = body;
    return body;
  },
}));

import { ListsPanel } from "@/aliz/lists-workspace";
import { ReasonOptions, ReasonPicker } from "@/aliz/reason-options";

describe("list order", () => {
  it("reorders by dragging the handle (keyboard arrows on the handle) and saves the order", async () => {
    render(<ListsPanel />);
    const names = () =>
      screen.getAllByLabelText("اسم المنصة").map((el) => (el as HTMLInputElement).value);
    expect(names().slice(0, 2)).toEqual(["هنقرستيشن", "جاهز"]);
    const handle = screen.getByLabelText(/اسحب لترتيب جاهز/);
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(names().slice(0, 2)).toEqual(["جاهز", "هنقرستيشن"]);
    // Already first: nothing moves.
    fireEvent.keyDown(screen.getByLabelText(/اسحب لترتيب جاهز/), { key: "ArrowUp" });
    expect(names()[0]).toBe("جاهز");
    fireEvent.click(screen.getByText("حفظ القوائم"));
    await screen.findByRole("status");
    const body = saved.body as { platforms: { label: string }[] };
    expect(body.platforms.slice(0, 2).map((p) => p.label)).toEqual(["جاهز", "هنقرستيشن"]);
  });
});

describe("grouped reasons", () => {
  it("adds the suggested reasons into their groups and saves the groups", async () => {
    render(<ListsPanel />);
    fireEvent.click(screen.getByText(/إضافة الأسباب المقترحة/));
    const labels = screen
      .getAllByLabelText("اسم السبب")
      .map((el) => (el as HTMLInputElement).value);
    // "طلب خاطئ" joins the order-problem group right after the built-in order reasons.
    expect(labels.indexOf("طلب خاطئ")).toBe(labels.indexOf("طلب في فرع آخر") + 1);
    expect(screen.queryByText(/إضافة الأسباب المقترحة/)).toBeNull();
    fireEvent.click(screen.getByText("حفظ القوائم"));
    await screen.findByRole("status");
    const body = saved.body as { categories: { label: string; group: string; urgent: boolean }[] };
    const foreign = body.categories.find((c) => c.label === "جسم غريب في الطعام")!;
    expect(foreign).toMatchObject({ group: "جودة الطعام", urgent: true });
  });

  it("shows reasons under group headings in the form", () => {
    const { container } = render(
      <select>
        <ReasonOptions
          reasons={[
            { id: "A", label: "تأخر الطلب", group: "مشكلة في الطلب" },
            { id: "B", label: "جسم غريب", group: "جودة الطعام", urgent: true },
            { id: "C", label: "أخرى", group: "" },
          ]}
        />
      </select>,
    );
    const groups = [...container.querySelectorAll("optgroup")].map((g) => g.label);
    expect(groups).toEqual(["مشكلة في الطلب", "جودة الطعام"]);
    expect(container.querySelector('optgroup[label="جودة الطعام"] option')?.textContent).toBe(
      "جسم غريب (عاجلة P1)",
    );
    expect(container.querySelector("select > option")?.textContent).toBe("أخرى");
  });
});

describe("other reason", () => {
  it("asks what the problem is only when Other is picked", () => {
    render(
      <form>
        <ReasonPicker
          reasons={[
            { id: "DELAY", label: "تأخر الطلب", group: "مشكلة في الطلب" },
            { id: "OTHER", label: "أخرى", group: "" },
          ]}
          label="سبب الشكوى"
          detailLabel="ما نوع المشكلة؟"
          detailPlaceholder="اكتب نوع المشكلة"
        />
      </form>,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("DELAY");
    expect(screen.queryByPlaceholderText("اكتب نوع المشكلة")).toBeNull();
    fireEvent.change(select, { target: { value: "OTHER" } });
    const box = screen.getByPlaceholderText("اكتب نوع المشكلة") as HTMLInputElement;
    expect(box.name).toBe("otherDetail");
    expect(box.required).toBe(true);
    fireEvent.change(select, { target: { value: "DELAY" } });
    expect(screen.queryByPlaceholderText("اكتب نوع المشكلة")).toBeNull();
  });
});
