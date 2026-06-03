/**
 * Model router - model-agnostic LLM provider layer.
 *
 * Supports any provider through the Vercel AI SDK provider interface.
 * Default providers: OpenAI, Anthropic, Google, Mistral.
 * Add more by installing the corresponding @ai-sdk/* package.
 *
 * Usage: modelRouter.getModel("openai/gpt-4o")
 *         modelRouter.getModel("anthropic/claude-sonnet-4-20250514")
 *         modelRouter.getModel("google/gemini-2.5-pro-exp-03-25")
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import type { LanguageModel } from "ai";

type ProviderName = "openai" | "anthropic" | "google" | "mistral";

type AIProvider =
  | ReturnType<typeof createOpenAI>
  | ReturnType<typeof createAnthropic>
  | ReturnType<typeof createGoogleGenerativeAI>
  | ReturnType<typeof createMistral>;

class ModelRouter {
  private providers: Map<ProviderName, { factory: () => AIProvider }> = new Map();

  constructor() {
    this.registerProviders();
  }

  private registerProviders() {
    if (process.env.OPENAI_API_KEY) {
      this.providers.set("openai", {
        factory: () => createOpenAI({ apiKey: process.env.OPENAI_API_KEY! }),
      });
    }

    if (process.env.ANTHROPIC_API_KEY) {
      this.providers.set("anthropic", {
        factory: () => createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }),
      });
    }

    if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      this.providers.set("google", {
        factory: () => createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY! }),
      });
    }

    if (process.env.MISTRAL_API_KEY) {
      this.providers.set("mistral", {
        factory: () => createMistral({ apiKey: process.env.MISTRAL_API_KEY! }),
      });
    }
  }

  /**
   * Get a model instance by provider/model string.
   * Examples: "openai/gpt-4o", "anthropic/claude-sonnet-4-20250514"
   *
   * Uses Vercel AI SDK v5's languageModel() method on the provider client.
   */
  getModel(providerModel: string): LanguageModel {
    const [provider, ...modelParts] = providerModel.split("/");
    const modelName = modelParts.join("/");

    const config = this.providers.get(provider as ProviderName);
    if (!config) {
      throw new Error(
        `Provider "${provider}" not configured. Set the corresponding API key. ` +
        `Available: ${Array.from(this.providers.keys()).join(", ")}`
      );
    }

    const client = config.factory() as unknown as {
      languageModel?: (id: string) => LanguageModel;
      chat?: (id: string) => LanguageModel;
    };

    if (typeof client.languageModel === "function") {
      return client.languageModel(modelName);
    }

    if (typeof client.chat === "function") {
      return client.chat(modelName);
    }

    throw new Error(
      `Provider "${provider}" does not expose a languageModel() method. ` +
      `This port targets @ai-sdk/* v1.x (v5 SDK).`
    );
  }

  /**
   * List all available providers that have API keys configured.
   */
  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}

export const modelRouter = new ModelRouter();
