import Ajv from "ajv";
import type { OutputSchema } from "./cma-loader.js";

const ajv = new Ajv({ allErrors: true, strict: false });

export interface ValidationResult {
  valid: boolean;
  data?: unknown;
  error?: string;
  rawText: string;
}

export async function validateSubagentOutput(
  text: string,
  schema?: OutputSchema
): Promise<ValidationResult> {
  if (!schema) {
    return { valid: true, data: text, rawText: text };
  }

  const jsonText = extractJson(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return {
      valid: false,
      rawText: text,
      error: `Subagent output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    const validate = ajv.compile(schema as unknown as Record<string, unknown>);
    const valid = validate(parsed);
    if (!valid) {
      return {
        valid: false,
        data: parsed,
        rawText: text,
        error: `Schema validation failed: ${ajv.errorsText(validate.errors)}`,
      };
    }
    return { valid: true, data: parsed, rawText: text };
  } catch (err) {
    return {
      valid: false,
      data: parsed,
      rawText: text,
      error: `Schema compilation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  const fenceMatch = /```(?:json)?\s*([\s\S]+?)\s*```/.exec(text);
  if (fenceMatch) return fenceMatch[1].trim();
  const braceStart = text.indexOf("{");
  if (braceStart >= 0) {
    const braceEnd = text.lastIndexOf("}");
    if (braceEnd > braceStart) return text.slice(braceStart, braceEnd + 1);
  }
  return trimmed;
}
