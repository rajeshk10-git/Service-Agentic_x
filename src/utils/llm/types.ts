import type { ChatCompletionMessage } from "openai/resources/chat/completions";

export interface LlmTurnResult {
  message: ChatCompletionMessage;
  finishReason: string | null;
}
