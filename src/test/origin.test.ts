import { afterEach, describe, expect, it, vi } from "vitest";
import { appOrigin, CRM_ORIGIN } from "@/functions/origin.server";

afterEach(() => vi.unstubAllEnvs());

describe("the CRM's public address", () => {
  it("is care.alizglobe.cloud when unset or still the old lovable.app address", () => {
    vi.stubEnv("PUBLIC_APP_ORIGIN", "");
    expect(appOrigin()).toBe(CRM_ORIGIN);
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://alizglobecrm.lovable.app/");
    expect(appOrigin()).toBe("https://care.alizglobe.cloud");
  });

  it("follows PUBLIC_APP_ORIGIN and refuses unsafe values", () => {
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://crm.example.com/path");
    expect(appOrigin()).toBe("https://crm.example.com");
    vi.stubEnv("PUBLIC_APP_ORIGIN", "http://localhost:3000");
    expect(appOrigin()).toBe("");
  });
});
