import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatchAgent } from "../../scripts/orchestrate.js";

describe("dispatchAgent", () => {
  const mockAgent = {
    generate: vi.fn(),
  };
  const mockMastra = {
    getAgent: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call agent.generate with the prompt", async () => {
    mockMastra.getAgent.mockReturnValue(mockAgent);
    mockAgent.generate.mockResolvedValue({ text: "test response" });

    const result = await dispatchAgent(
      mockMastra as any,
      "pitch-agent/pitch-researcher",
      "test prompt"
    );

    expect(result).toBe("test response");
    expect(mockAgent.generate).toHaveBeenCalledWith("test prompt");
  });

  it("should call getAgent with scoped key", async () => {
    mockMastra.getAgent.mockReturnValue(mockAgent);
    mockAgent.generate.mockResolvedValue({ text: "response" });

    await dispatchAgent(
      mockMastra as any,
      "earnings-reviewer/earnings-transcript-reader",
      "analyze this"
    );

    expect(mockMastra.getAgent).toHaveBeenCalledWith(
      "earnings-reviewer/earnings-transcript-reader"
    );
  });

  it("should call getAgent with bare subagent name as fallback", async () => {
    const mockAgents: Record<string, any> = {
      "pitch-agent": {},
      "pitch-agent/pitch-researcher": mockAgent,
    };
    (mockMastra as any).agents = mockAgents;
    mockAgent.generate.mockResolvedValue({ text: "response" });

    await dispatchAgent(
      mockMastra as any,
      "pitch-researcher",
      "research"
    );

    expect(mockMastra.getAgent).toHaveBeenCalled();
  });

  it("should throw when agent not found", async () => {
    mockMastra.getAgent.mockReturnValue(null);

    await expect(
      dispatchAgent(mockMastra as any, "pitch-agent/pitch-researcher", "prompt")
    ).rejects.toThrow("not found");
  });

  it("should handle generate errors", async () => {
    mockMastra.getAgent.mockReturnValue(mockAgent);
    mockAgent.generate.mockRejectedValue(new Error("generation failed"));

    await expect(
      dispatchAgent(mockMastra as any, "pitch-agent/pitch-researcher", "prompt")
    ).rejects.toThrow("generation failed");
  });
});
