import { describe, expect, it } from "vitest";
import { canOpenView, hiddenViews } from "@/aliz/access";
import { permissionsForRole } from "@/lib/domain";

describe("Google reviews page", () => {
  const perms = permissionsForRole("SUPER_ADMIN");
  it("stays hidden until the Google account is connected", () => {
    expect(canOpenView("reviews", perms, "SUPER_ADMIN", hiddenViews({ integrations: {} }))).toBe(
      false,
    );
    expect(
      canOpenView("reviews", perms, "SUPER_ADMIN", hiddenViews({ integrations: { google: true } })),
    ).toBe(true);
    expect(canOpenView("tickets", perms, "SUPER_ADMIN", hiddenViews({}))).toBe(true);
  });
});
