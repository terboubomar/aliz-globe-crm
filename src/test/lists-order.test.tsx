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
