import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatchSubagent } from "../lib/dispatch.js";

describe("dispatchSubagent timer cleanup", () => {
  const mockAgent = {
    generate: vi.fn(),
  };
  const mockMastra = {
    getAgent: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should resolve quickly on success without keeping the timer alive", async () => {
    mockMastra.getAgent.mockReturnValue(mockAgent);
    mockAgent.generate.mockResolvedValue({ text: "ok" });

    const start = Date.now();
    const result = await dispatchSubagent(
      mockMastra as any,
      "pitch-agent/pitch-researcher",
      "prompt"
    );
    const elapsed = Date.now() - start;

    expect(result).toBe("ok");
    expect(elapsed).toBeLessThan(1000);
  });

  it("should reject with the underlying error message on failure", async () => {
    mockMastra.getAgent.mockReturnValue(mockAgent);
    mockAgent.generate.mockRejectedValue(new Error("generation failed"));

    await expect(
      dispatchSubagent(
        mockMastra as any,
        "pitch-agent/pitch-researcher",
        "prompt"
      )
    ).rejects.toThrow("generation failed");
  });

  it("should reject with a timeout error when generate never resolves", async () => {
    mockMastra.getAgent.mockReturnValue(mockAgent);
    mockAgent.generate.mockImplementation(
      () => new Promise(() => {}) as Promise<any>
    );

    await expect(
      dispatchSubagent(
        mockMastra as any,
        "pitch-agent/pitch-researcher",
        "prompt",
        50
      )
    ).rejects.toThrow(/timed out after 50ms/);
  });

  it("should not keep timers alive after a successful resolution", async () => {
    vi.useFakeTimers();
    try {
      mockMastra.getAgent.mockReturnValue(mockAgent);
      mockAgent.generate.mockResolvedValue({ text: "done" });

      const pending = dispatchSubagent(
        mockMastra as any,
        "pitch-agent/pitch-researcher",
        "prompt",
        5000
      );

      await vi.advanceTimersByTimeAsync(0);
      const result = await pending;

      expect(result).toBe("done");
    } finally {
      vi.useRealTimers();
    }
  });
});
