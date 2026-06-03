import { describe, it, expect } from "vitest";
import { validateSubagentOutput } from "../lib/output-schema-validator.js";
import type { OutputSchema } from "../lib/cma-loader.js";

const sampleSchema: OutputSchema = {
  type: "object",
  required: ["target", "comps"],
  additionalProperties: false,
  properties: {
    target: { type: "string" },
    comps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ticker: { type: "string" },
          metric: { type: "string" },
          value: { type: "number" },
        },
        required: ["ticker", "metric", "value"],
      },
    },
  },
};

describe("validateSubagentOutput", () => {
  it("returns valid:true with parsed data when JSON matches the schema", async () => {
    const text = JSON.stringify({
      target: "ACME",
      comps: [{ ticker: "FOO", metric: "EV/EBITDA", value: 12.5 }],
    });

    const result = await validateSubagentOutput(text, sampleSchema);

    expect(result.valid).toBe(true);
    expect(result.data).toEqual({
      target: "ACME",
      comps: [{ ticker: "FOO", metric: "EV/EBITDA", value: 12.5 }],
    });
    expect(result.error).toBeUndefined();
    expect(result.rawText).toBe(text);
  });

  it("returns valid:false when the output is plain text (not JSON)", async () => {
    const text = "Here is the comp table: ACME, EV/EBITDA = 12.5x, etc.";

    const result = await validateSubagentOutput(text, sampleSchema);

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not valid JSON/);
    expect(result.data).toBeUndefined();
    expect(result.rawText).toBe(text);
  });

  it("returns valid:false with schema errors when JSON parses but doesn't match the schema", async () => {
    const text = JSON.stringify({
      target: "ACME",
      comps: [{ ticker: "FOO", metric: "EV/EBITDA" }],
    });

    const result = await validateSubagentOutput(text, sampleSchema);

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Schema validation failed/);
    expect(result.data).toEqual({
      target: "ACME",
      comps: [{ ticker: "FOO", metric: "EV/EBITDA" }],
    });
    expect(result.rawText).toBe(text);
  });

  it("extracts JSON wrapped in markdown code fences", async () => {
    const inner = JSON.stringify({
      target: "ACME",
      comps: [{ ticker: "FOO", metric: "EV/EBITDA", value: 12.5 }],
    });
    const text = "Here you go:\n\n```json\n" + inner + "\n```\n";

    const result = await validateSubagentOutput(text, sampleSchema);

    expect(result.valid).toBe(true);
    expect(result.data).toEqual({
      target: "ACME",
      comps: [{ ticker: "FOO", metric: "EV/EBITDA", value: 12.5 }],
    });
  });

  it("returns valid:true with raw text when no schema is provided", async () => {
    const text = "Plain unstructured response, no schema required.";

    const result = await validateSubagentOutput(text);

    expect(result.valid).toBe(true);
    expect(result.data).toBe(text);
    expect(result.error).toBeUndefined();
    expect(result.rawText).toBe(text);
  });

  it("returns valid:true with raw text when schema is undefined", async () => {
    const text = '{"anything": "goes"}';

    const result = await validateSubagentOutput(text, undefined);

    expect(result.valid).toBe(true);
    expect(result.data).toBe(text);
  });

  it("rejects schema-violating JSON when only a missing required field is wrong", async () => {
    const text = JSON.stringify({ target: "ACME" });

    const result = await validateSubagentOutput(text, sampleSchema);

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Schema validation failed/);
    expect(result.error).toMatch(/comps/);
  });
});
