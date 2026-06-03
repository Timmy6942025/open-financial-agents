import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatchAgent } from "../../scripts/orchestrate.js";

describe("cma-loader: scoped subagent ID resolution", () => {
  const earningsAgent = { generate: vi.fn() };
  const marketAgent = { generate: vi.fn() };
  const mockMastra: any = {
    agents: {
      "earnings-reviewer/note-writer": earningsAgent,
      "market-researcher/note-writer": marketAgent,
    },
    getAgent: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMastra.getAgent.mockImplementation((id: string) => {
      return mockMastra.agents[id];
    });
  });

  it("should dispatch earnings-reviewer/note-writer to the earnings agent", async () => {
    earningsAgent.generate.mockResolvedValue({ text: "earnings output" });

    const result = await dispatchAgent(
      mockMastra,
      "earnings-reviewer/note-writer",
      "write earnings note"
    );

    expect(result).toBe("earnings output");
    expect(mockMastra.getAgent).toHaveBeenCalledWith(
      "earnings-reviewer/note-writer"
    );
    expect(earningsAgent.generate).toHaveBeenCalledWith("write earnings note");
    expect(marketAgent.generate).not.toHaveBeenCalled();
  });

  it("should dispatch market-researcher/note-writer to the market agent", async () => {
    marketAgent.generate.mockResolvedValue({ text: "market output" });

    const result = await dispatchAgent(
      mockMastra,
      "market-researcher/note-writer",
      "write market note"
    );

    expect(result).toBe("market output");
    expect(mockMastra.getAgent).toHaveBeenCalledWith(
      "market-researcher/note-writer"
    );
    expect(marketAgent.generate).toHaveBeenCalledWith("write market note");
    expect(earningsAgent.generate).not.toHaveBeenCalled();
  });

  it("should resolve a bare name to the correct scoped key when the bare name is unique", async () => {
    const uniqueAgent = { generate: vi.fn() };
    mockMastra.agents["pitch-agent/pitch-researcher"] = uniqueAgent;
    uniqueAgent.generate.mockResolvedValue({ text: "pitch output" });

    const result = await dispatchAgent(
      mockMastra,
      "pitch-researcher",
      "research"
    );

    expect(result).toBe("pitch output");
    expect(uniqueAgent.generate).toHaveBeenCalledWith("research");
  });
});

describe("cma-loader: ${VAR} URL-context substitution", () => {
  const URL_VAR_REGEX = /:\/\/\$\{[A-Z_]+\}/;

  it("should match a ${VAR} that appears inside a URL", () => {
    expect(URL_VAR_REGEX.test("https://${HOST}/path")).toBe(true);
    expect(URL_VAR_REGEX.test("http://${API_HOST}:8080/foo")).toBe(true);
  });

  it("should NOT match a ${VAR} that appears in a description", () => {
    expect(URL_VAR_REGEX.test("Description with ${COMPANY_NAME} placeholder")).toBe(
      false
    );
    expect(URL_VAR_REGEX.test("The system prompt ${GREETING}")).toBe(false);
  });

  it("should NOT match a ${VAR} that uses lowercase or mixed-case", () => {
    expect(URL_VAR_REGEX.test("https://${host}/path")).toBe(false);
    expect(URL_VAR_REGEX.test("https://${Host}/path")).toBe(false);
  });

  it("should produce a parseable URL host when the URL ${VAR} is replaced with localhost/placeholder", () => {
    const raw = "https://${HOST}/api/v1";
    const resolved = raw.replace(URL_VAR_REGEX, "://localhost/placeholder");
    const url = new URL(resolved);

    expect(url.host).toBe("localhost");
    expect(url.pathname.startsWith("/placeholder")).toBe(true);
  });
});
