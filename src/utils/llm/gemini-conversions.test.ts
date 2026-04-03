import {
  extractSystemAndRest,
  openAiMessagesToGeminiContents,
  mapGeminiCandidateToOpenAI,
} from "./gemini-conversions";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

describe("extractSystemAndRest", () => {
  it("separates system messages from others", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: "You are a helper." },
      { role: "user", content: "Hi" },
      { role: "system", content: "Be concise." },
      { role: "assistant", content: "Hello!" },
    ];
    const { system, rest } = extractSystemAndRest(messages);
    expect(system).toBe("You are a helper.\n\nBe concise.");
    expect(rest).toHaveLength(2);
    expect(rest[0]).toEqual({ role: "user", content: "Hi" });
    expect(rest[1]).toEqual({ role: "assistant", content: "Hello!" });
  });

  it("returns empty system string when no system messages", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "user", content: "Hi" },
    ];
    const { system, rest } = extractSystemAndRest(messages);
    expect(system).toBe("");
    expect(rest).toHaveLength(1);
  });

  it("handles empty message array", () => {
    const { system, rest } = extractSystemAndRest([]);
    expect(system).toBe("");
    expect(rest).toHaveLength(0);
  });
});

describe("openAiMessagesToGeminiContents", () => {
  it("converts user messages to Gemini format", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "user", content: "Hello" },
    ];
    const result = openAiMessagesToGeminiContents(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].parts).toEqual([{ text: "Hello" }]);
  });

  it("converts assistant messages to model role", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "assistant", content: "Hi there" },
    ];
    const result = openAiMessagesToGeminiContents(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("model");
    expect(result[0].parts).toEqual([{ text: "Hi there" }]);
  });

  it("converts assistant with tool_calls to functionCall parts", () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function" as const,
            function: {
              name: "get_weather",
              arguments: '{"city":"London"}',
            },
          },
        ],
      },
    ];
    const result = openAiMessagesToGeminiContents(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("model");
    expect(result[0].parts[0]).toEqual({
      functionCall: { name: "get_weather", args: { city: "London" } },
    });
  });

  it("converts tool messages to functionResponse parts", () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function" as const,
            function: { name: "get_weather", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        content: '{"temp":20}',
        tool_call_id: "call_1",
      },
    ];
    const result = openAiMessagesToGeminiContents(messages);
    expect(result).toHaveLength(2);
    expect(result[1].role).toBe("function");
    expect(result[1].parts[0]).toEqual({
      functionResponse: {
        name: "get_weather",
        response: { temp: 20 },
      },
    });
  });

  it("uses 'unknown_tool' when no pending tool name available", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "tool", content: '"result"', tool_call_id: "call_orphan" },
    ];
    const result = openAiMessagesToGeminiContents(messages);
    expect(result[0].parts[0]).toMatchObject({
      functionResponse: { name: "unknown_tool" },
    });
  });

  it("wraps non-parseable tool content in output wrapper", () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function" as const,
            function: { name: "my_tool", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        content: "plain text result",
        tool_call_id: "call_1",
      },
    ];
    const result = openAiMessagesToGeminiContents(messages);
    expect(result[1].parts[0]).toEqual({
      functionResponse: {
        name: "my_tool",
        response: { output: "plain text result" },
      },
    });
  });

  it("handles non-string user content by JSON-stringifying", () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: "user",
        content: [{ type: "text" as const, text: "hello" }],
      },
    ];
    const result = openAiMessagesToGeminiContents(messages);
    expect(result[0].parts[0]).toEqual({
      text: JSON.stringify([{ type: "text", text: "hello" }]),
    });
  });
});

describe("mapGeminiCandidateToOpenAI", () => {
  it("maps text response to ChatCompletionMessage", () => {
    const candidate = {
      content: {
        parts: [{ text: "Hello world" }],
      },
    };
    const result = mapGeminiCandidateToOpenAI(candidate);
    expect(result.role).toBe("assistant");
    expect(result.content).toBe("Hello world");
    expect(result.tool_calls).toBeUndefined();
  });

  it("maps functionCall to tool_calls", () => {
    const candidate = {
      content: {
        parts: [
          {
            functionCall: {
              name: "get_data",
              args: { id: 123 },
            },
          },
        ],
      },
    };
    const result = mapGeminiCandidateToOpenAI(candidate);
    expect(result.content).toBe(null);
    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls![0].function.name).toBe("get_data");
    expect(result.tool_calls![0].function.arguments).toBe('{"id":123}');
    expect(result.tool_calls![0].type).toBe("function");
    expect(result.tool_calls![0].id).toMatch(/^call_/);
  });

  it("concatenates multiple text parts", () => {
    const candidate = {
      content: {
        parts: [{ text: "Hello " }, { text: "World" }],
      },
    };
    const result = mapGeminiCandidateToOpenAI(candidate);
    expect(result.content).toBe("Hello World");
  });

  it("handles mixed text and function parts", () => {
    const candidate = {
      content: {
        parts: [
          { text: "Calling tool..." },
          { functionCall: { name: "search", args: { q: "test" } } },
        ],
      },
    };
    const result = mapGeminiCandidateToOpenAI(candidate);
    expect(result.content).toBe("Calling tool...");
    expect(result.tool_calls).toHaveLength(1);
  });

  it("returns null content and no tool_calls for undefined candidate", () => {
    const result = mapGeminiCandidateToOpenAI(undefined);
    expect(result.role).toBe("assistant");
    expect(result.content).toBe(null);
    expect(result.tool_calls).toBeUndefined();
  });

  it("returns null content for empty parts array", () => {
    const candidate = { content: { parts: [] } };
    const result = mapGeminiCandidateToOpenAI(candidate);
    expect(result.content).toBe(null);
  });
});
