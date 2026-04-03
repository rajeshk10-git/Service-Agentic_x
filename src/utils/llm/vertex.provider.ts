import {
  FunctionDeclarationSchemaType,
  VertexAI,
  type Content,
  type Tool,
} from "@google-cloud/vertexai";
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

let vertexAI: VertexAI | null = null;

function getVertexAI(): VertexAI {
  if (!vertexAI) {
    vertexAI = new VertexAI({
      project: env.GCP_PROJECT_ID,
      location: env.GCP_LOCATION,
    });
  }
  return vertexAI;
}

function mapJsonType(
  t: string | undefined,
): FunctionDeclarationSchemaType {
  switch (t) {
    case "string":
      return FunctionDeclarationSchemaType.STRING;
    case "number":
      return FunctionDeclarationSchemaType.NUMBER;
    case "integer":
      return FunctionDeclarationSchemaType.INTEGER;
    case "boolean":
      return FunctionDeclarationSchemaType.BOOLEAN;
    case "array":
      return FunctionDeclarationSchemaType.ARRAY;
    case "object":
    default:
      return FunctionDeclarationSchemaType.OBJECT;
  }
}

function jsonSchemaToVertexParameters(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return { type: FunctionDeclarationSchemaType.OBJECT, properties: {} };
  }
  const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = (schema.required as string[] | undefined) ?? [];

  const properties: Record<string, unknown> = {};
  if (props) {
    for (const [key, sub] of Object.entries(props)) {
      const subType = mapJsonType(sub.type as string | undefined);
      if (subType === FunctionDeclarationSchemaType.OBJECT && sub.properties) {
        properties[key] = jsonSchemaToVertexParameters(sub);
      } else if (subType === FunctionDeclarationSchemaType.ARRAY && sub.items) {
        properties[key] = {
          type: FunctionDeclarationSchemaType.ARRAY,
          items: jsonSchemaToVertexParameters(
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
    type: FunctionDeclarationSchemaType.OBJECT,
    properties,
    required: required.length ? required : undefined,
  };
}

function openAiToolsToGemini(
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
        parameters: jsonSchemaToVertexParameters(params),
      };
    });
  return [{ functionDeclarations: declarations }];
}

export async function createVertexCompletion(
  messages: ChatCompletionMessageParam[],
  options?: { toolChoice?: "auto" | "none" },
): Promise<LlmTurnResult> {
  const { system, rest } = extractSystemAndRest(messages);
  const contents = openAiMessagesToGeminiContents(rest);

  const generativeModel = getVertexAI().getGenerativeModel({
    model: env.VERTEX_GEMINI_MODEL,
    ...(system
      ? {
          systemInstruction: {
            role: "system",
            parts: [{ text: system }],
          },
        }
      : {}),
    tools:
      options?.toolChoice === "none"
        ? undefined
        : (openAiToolsToGemini(getAgentTools()) as Tool[]),
  });

  const result = await generativeModel.generateContent({
    contents: contents as unknown as Content[],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
    },
  });

  const response = result.response;
  const candidate = response.candidates?.[0] as
    | Record<string, unknown>
    | undefined;

  const message = mapGeminiCandidateToOpenAI(candidate);
  const finishReason = candidate?.finishReason as string | undefined;

  return {
    message,
    finishReason: finishReason ?? null,
  };
}
