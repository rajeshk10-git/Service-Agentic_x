import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { env } from "../../config/env";
import { createOpenAICompletion } from "./openai.provider";
import { getAgentTools } from "./tools";
import type { LlmTurnResult } from "./types";

export { getAgentTools };
export type { LlmTurnResult };

export async function createChatCompletion(
  messages: ChatCompletionMessageParam[],
  options?: { toolChoice?: "auto" | "none" },
): Promise<LlmTurnResult> {
  if (env.LLM_PROVIDER === "vertex") {
    const { createVertexCompletion } = await import("./vertex.provider");
    return createVertexCompletion(messages, options);
  }
  if (env.LLM_PROVIDER === "google-ai") {
    const { createGoogleAiCompletion } = await import("./google-ai.provider");
    return createGoogleAiCompletion(messages, options);
  }
  return createOpenAICompletion(messages, options);
}
