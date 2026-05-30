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
   * Uses type-safe Vercel AI SDK model() method instead of property access.
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

    const client = config.factory();

    // Type-safe model lookup via Vercel AI SDK's model() method
    // The model name uses "provider/model" format (e.g. "openai/gpt-4o")
    const fullModelId = providerModel; // e.g. "openai/gpt-4o"

    // Use type assertion to the Vercel AI SDK's model method
    // This is the correct API for getting models from provider instances
    try {
      const modelGetter = (client as unknown as Record<string, (modelId: string) => LanguageModel>)["model"];
      if (typeof modelGetter === "function") {
        return modelGetter(fullModelId);
      }
    } catch {
      // Fall through to property access
    }

    // Fallback: property access on provider (how Vercel AI SDK exposes models)
    const providerKey = provider as ProviderName;
    if (providerKey === "openai") {
      const openaiClient = client as ReturnType<typeof createOpenAI>;
      return (openaiClient as any)[modelName] as LanguageModel;
    }
    if (providerKey === "anthropic") {
      const anthropicClient = client as ReturnType<typeof createAnthropic>;
      return (anthropicClient as any)[modelName] as LanguageModel;
    }
    if (providerKey === "google") {
      const googleClient = client as ReturnType<typeof createGoogleGenerativeAI>;
      return (googleClient as any)[modelName] as LanguageModel;
    }
    if (providerKey === "mistral") {
      const mistralClient = client as ReturnType<typeof createMistral>;
      return (mistralClient as any)[modelName] as LanguageModel;
    }

    throw new Error(`Unsupported provider: ${provider}`);
  }

  /**
   * List all available providers that have API keys configured.
   */
  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}

export const modelRouter = new ModelRouter();
