import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const taxToolDefinition: ChatCompletionTool = {
  type: "function",
  function: {
    name: "calculate_tax",
    description:
      "Estimate Indian income tax for a salaried individual. Calls a Python rules service. Provide annual_gross (rupees) and regime (old or new) when possible.",
    parameters: {
      type: "object",
      properties: {
        annual_gross: {
          type: "number",
          description: "Estimated annual gross taxable income in INR",
        },
        regime: {
          type: "string",
          enum: ["old", "new"],
          description: "Tax regime under Indian IT Act (old vs new)",
        },
        standard_deduction: {
          type: "number",
          description: "Optional: standard deduction already considered by backend",
        },
        section_80c: {
          type: "number",
          description: "Optional: 80C investments (old regime)",
        },
      },
      required: ["annual_gross", "regime"],
    },
  },
};

export interface CalculateTaxArgs {
  annual_gross: number;
  regime: "old" | "new";
  standard_deduction?: number;
  section_80c?: number;
}
