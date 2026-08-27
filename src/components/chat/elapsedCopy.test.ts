import { describe, expect, it } from "vitest";
import { elapsedResearchCopy } from "./elapsedCopy";

describe("elapsedResearchCopy", () => {
  it("reads as an early, fast lookup under 15s", () => {
    expect(elapsedResearchCopy(0, false)).toMatch(/pulling records/i);
    expect(elapsedResearchCopy(14_999, false)).toMatch(/pulling records/i);
  });

  it("reads as cross-checking between 15s and 60s", () => {
    expect(elapsedResearchCopy(15_000, false)).toMatch(/cross-checking/i);
    expect(elapsedResearchCopy(59_999, false)).toMatch(/cross-checking/i);
  });

  it("names deep research specifically past 60s when it's on", () => {
    expect(elapsedResearchCopy(60_000, true)).toMatch(/deep research/i);
  });

  it("gives a generic 'still digging' message past 60s when deep research is off", () => {
    expect(elapsedResearchCopy(90_000, false)).toMatch(/taking some digging/i);
  });
});
