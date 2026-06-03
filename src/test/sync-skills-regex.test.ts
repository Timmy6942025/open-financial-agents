import { describe, it, expect } from "vitest";

describe("sync-skills.ts flat .md detection regex", () => {
  const FLAT_MD_REGEX = /\.md$/;

  it("should match .md at end of filename", () => {
    expect(FLAT_MD_REGEX.test("comps-analysis.md")).toBe(true);
    expect(FLAT_MD_REGEX.test("kyc-doc-parse.md")).toBe(true);
    expect(FLAT_MD_REGEX.test("deck-refresh.md")).toBe(true);
  });

  it("should not match files without .md extension", () => {
    expect(FLAT_MD_REGEX.test("SKILL.md.bak")).toBe(false);
    expect(FLAT_MD_REGEX.test("readme")).toBe(false);
  });

  it("should not match a literal backslash + .md (the old bug)", () => {
    const OLD_BUG_REGEX = /\\.md$/;
    expect(OLD_BUG_REGEX.test("comps-analysis.md")).toBe(false);
    expect(FLAT_MD_REGEX.test("comps-analysis.md")).toBe(true);
  });
});
