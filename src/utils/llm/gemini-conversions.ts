import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { randomUUID } from "crypto";

export function extractSystemAndRest(
  messages: ChatCompletionMessageParam[],
): { system: string; rest: ChatCompletionMessageParam[] } {
  const systemParts: string[] = [];
  const rest: ChatCompletionMessageParam[] = [];
  for (const m of messages) {
    if (m.role === "system" && typeof m.content === "string") {
      systemParts.push(m.content);
    } else {
      rest.push(m);
    }
  }
  return { system: systemParts.join("\n\n"), rest };
}

export function openAiMessagesToGeminiContents(
  messages: ChatCompletionMessageParam[],
): { role: string; parts: Record<string, unknown>[] }[] {
  const contents: { role: string; parts: Record<string, unknown>[] }[] = [];
  let pendingToolNames: string[] = [];

  for (const m of messages) {
    if (m.role === "user") {
      const text =
        typeof m.content === "string"
          ? m.content
          : JSON.stringify(m.content);
      contents.push({ role: "user", parts: [{ text }] });
      continue;
    }

    if (m.role === "assistant") {
      const parts: Record<string, unknown>[] = [];
      if (typeof m.content === "string" && m.content.trim()) {
        parts.push({ text: m.content });
      }
      if ("tool_calls" in m && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        pendingToolNames = m.tool_calls.map((tc) => tc.function.name);
        for (const tc of m.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = tc.function.arguments
              ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
              : {};
          } catch {
            args = { raw: tc.function.arguments };
          }
          parts.push({
            functionCall: {
              name: tc.function.name,
              args,
            },
          });
        }
      } else {
        pendingToolNames = [];
      }
      contents.push({ role: "model", parts });
      continue;
    }

    if (m.role === "tool") {
      const name = pendingToolNames.shift() ?? "unknown_tool";
      let responsePayload: unknown;
      try {
        responsePayload = JSON.parse(m.content as string);
      } catch {
        responsePayload = { output: m.content };
      }
      const responseObj =
        responsePayload &&
        typeof responsePayload === "object" &&
        !Array.isArray(responsePayload)
          ? (responsePayload as Record<string, unknown>)
          : { output: responsePayload };
      contents.push({
        role: "function",
        parts: [
          {
            functionResponse: {
              name,
              response: responseObj,
            },
          },
        ],
      });
      continue;
    }
  }

  return contents;
}

export function mapGeminiCandidateToOpenAI(
  candidate: Record<string, unknown> | undefined,
): ChatCompletionMessage {
  const content = candidate?.content as
    | { parts?: Record<string, unknown>[] }
    | undefined;
  const parts = content?.parts ?? [];

  let text = "";
  const tool_calls: NonNullable<ChatCompletionMessage["tool_calls"]> = [];

  for (const p of parts) {
    if (typeof p.text === "string") {
      text += p.text;
    }
    const fc = p.functionCall as
      | { name?: string; args?: Record<string, unknown> }
      | undefined;
    if (fc?.name) {
      tool_calls.push({
        id: `call_${randomUUID()}`,
        type: "function",
        function: {
          name: fc.name,
          arguments: JSON.stringify(fc.args ?? {}),
        },
      });
    }
  }

  return {
    role: "assistant",
    content: text || null,
    tool_calls: tool_calls.length ? tool_calls : undefined,
    refusal: null,
  } as ChatCompletionMessage;
}
