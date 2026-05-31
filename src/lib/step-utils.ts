import { createStep } from "@mastra/core/workflows";
import { z } from "zod";

export type StepConfig<I extends z.ZodTypeAny, O extends z.ZodTypeAny> = {
  id: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  /**
   * Optional mapper for handoff passthrough. When a previous step emits
   * a handoff, this function maps the current step's input fields to the
   * expected output shape. Required when input and output schemas differ.
   *
   * The input parameter includes the step's input fields plus an optional
   * `handoff` field from the previous step.
   */
  passthroughMapper?: (input: z.infer<I> & { handoff?: unknown }) => z.infer<O>;
  execute: (opts: {
    input: z.infer<I>;
    mastra: any;
  }) => Promise<z.infer<O>>;
};

/**
 * Wraps createStep with automatic handoff pass-through and error wrapping.
 *
 * If inputData.handoff is set, the step is skipped and the passthroughMapper
 * (if provided) constructs the output. Otherwise only `handoff` is forwarded.
 * Errors are wrapped with the step ID for clean stack traces.
 */
export function defineStep<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  config: StepConfig<I, O>
) {
  return createStep({
    id: config.id,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    execute: async ({ inputData, mastra }: { inputData: any; mastra: any }) => {
      // If previous step emitted a handoff, skip execution
      if (inputData.handoff) {
        if (config.passthroughMapper) {
          return config.passthroughMapper(inputData);
        }
        // Default: only forward handoff (no field mapping assumed)
        return { handoff: inputData.handoff } as z.infer<O>;
      }

      try {
        return await config.execute({ input: inputData as z.infer<I>, mastra });
      } catch (err: any) {
        throw new Error(`${config.id} failed: ${err.message}`);
      }
    },
  });
}
