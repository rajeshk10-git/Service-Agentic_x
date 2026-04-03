import axios from "axios";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { env } from "../../config/env";
import { getAgentTools } from "./tools";
import type { LlmTurnResult } from "./types";
import {
  extractSystemAndRest,
  mapGeminiCandidateToOpenAI,
  openAiMessagesToGeminiContents,
} from "./gemini-conversions";

const GOOGLE_AI_GENERATE_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

function mapJsonType(t: string | undefined): string {
  switch (t) {
    case "string":
      return "STRING";
    case "number":
      return "NUMBER";
    case "integer":
      return "INTEGER";
    case "boolean":
      return "BOOLEAN";
    case "array":
      return "ARRAY";
    case "object":
    default:
      return "OBJECT";
  }
}

/** OpenAPI-style JSON Schema → Gemini REST Schema (uppercase type enums). */
function jsonSchemaToGeminiRestParameters(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return { type: "OBJECT", properties: {} };
  }
  const props = schema.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  const required = (schema.required as string[] | undefined) ?? [];

  const properties: Record<string, unknown> = {};
  if (props) {
    for (const [key, sub] of Object.entries(props)) {
      const subType = mapJsonType(sub.type as string | undefined);
      if (subType === "OBJECT" && sub.properties) {
        properties[key] = jsonSchemaToGeminiRestParameters(sub);
      } else if (subType === "ARRAY" && sub.items) {
        properties[key] = {
          type: "ARRAY",
          items: jsonSchemaToGeminiRestParameters(
            sub.items as Record<string, unknown>,
          ),
        };
      } else {
        const base: Record<string, unknown> = {
          type: subType,
          description: sub.description,
        };
        if (sub.enum) {
          base.enum = sub.enum;
        }
        properties[key] = base;
      }
    }
  }

  return {
    type: "OBJECT",
    properties,
    ...(required.length ? { required } : {}),
  };
}

function openAiToolsToGeminiRest(
  tools: ChatCompletionTool[],
): { functionDeclarations: Record<string, unknown>[] }[] {
  const declarations = tools
    .filter((t) => t.type === "function")
    .map((t) => {
      const fn = t.function;
      const params = fn.parameters as unknown as Record<string, unknown>;
      return {
        name: fn.name,
        description: fn.description ?? "",
        parameters: jsonSchemaToGeminiRestParameters(params),
      };
    });
  return [{ functionDeclarations: declarations }];
}

export async function createGoogleAiCompletion(
  messages: ChatCompletionMessageParam[],
  options?: { toolChoice?: "auto" | "none" },
): Promise<LlmTurnResult> {
  const apiKey = env.GOOGLE_AI_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("GOOGLE_AI_API_KEY is required for LLM_PROVIDER=google-ai");
  }

  const model = env.GOOGLE_AI_MODEL.replace(/^models\//, "");
  const url = new URL(
    `${GOOGLE_AI_GENERATE_BASE}/${encodeURIComponent(model)}:generateContent`,
  );
  url.searchParams.set("key", apiKey.trim());

  const { system, rest } = extractSystemAndRest(messages);
  const contents = openAiMessagesToGeminiContents(rest);

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
    },
  };

  if (system) {
    body.systemInstruction = {
      role: "system",
      parts: [{ text: system }],
    };
  }

  if (options?.toolChoice !== "none") {
    body.tools = openAiToolsToGeminiRest(getAgentTools());
  }

  // Same as: POST .../v1beta/models/{model}:generateContent?key=...  Content-Type: application/json
  let json: Record<string, unknown>;
  try {
    const { data } = await axios.post<Record<string, unknown>>(
      url.toString(),
      body,
      { headers: { "Content-Type": "application/json" } },
    );
    json = data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const payload = err.response?.data as Record<string, unknown> | undefined;
      const apiMsg = (payload?.error as { message?: string } | undefined)?.message;
      const snippet =
        typeof err.response?.data === "string"
          ? err.response.data.slice(0, 800)
          : JSON.stringify(payload ?? {}).slice(0, 800);
      throw new Error(
        `Google AI generateContent failed${status != null ? ` (${status})` : ""}: ${apiMsg ?? err.message ?? snippet}`,
      );
    }
    throw err;
  }

  const apiErr = json.error as { message?: string } | undefined;
  if (apiErr?.message) {
    throw new Error(`Google AI generateContent: ${apiErr.message}`);
  }

  const candidates = json.candidates as Record<string, unknown>[] | undefined;
  const candidate = candidates?.[0];
  const message = mapGeminiCandidateToOpenAI(candidate);
  const finishReason = candidate?.finishReason as string | undefined;

  return {
    message,
    finishReason: finishReason ?? null,
  };
}
