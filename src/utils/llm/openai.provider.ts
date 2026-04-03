import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { env } from "../../config/env";
import { getAgentTools } from "./tools";
import type { LlmTurnResult } from "./types";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export async function createOpenAICompletion(
  messages: ChatCompletionMessageParam[],
  options?: { toolChoice?: "auto" | "none" },
): Promise<LlmTurnResult> {
  const completion = await openai.chat.completions.create({
    model: env.OPENAI_MODEL,
    messages,
    tools: options?.toolChoice === "none" ? undefined : getAgentTools(),
    tool_choice: options?.toolChoice === "none" ? "none" : "auto",
    temperature: 0.2,
  });

  const choice = completion.choices[0];
  if (!choice?.message) {
    throw new Error("OpenAI returned no message choice");
  }

  return {
    message: choice.message,
    finishReason: choice.finish_reason ?? null,
  };
}
