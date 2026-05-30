/**
 * Port of validate.py — schema validation for agent output.
 *
 * Usage: npx tsx scripts/validate.ts <output.json> <schema.json|schema.yaml>
 * Exits 0 on valid, 1 on invalid.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv";
import * as yaml from "yaml";

const ajv = new Ajv({ allErrors: true });

function load(filePath: string): unknown {
  const text = readFileSync(filePath, "utf-8");
  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    return yaml.parse(text);
  }
  return JSON.parse(text);
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error("Usage: validate.ts <output.json> <schema.json|schema.yaml>");
    return 2;
  }

  const instance = load(resolve(args[0]));
  const schema = load(resolve(args[1]));

  const validate = ajv.compile(schema as Record<string, unknown>);
  const valid = validate(instance);

  if (!valid) {
    for (const err of validate.errors || []) {
      console.error(`INVALID: ${err.message} at ${err.instancePath}`);
    }
    return 1;
  }

  console.log("OK");
  return 0;
}

process.exit(main());
