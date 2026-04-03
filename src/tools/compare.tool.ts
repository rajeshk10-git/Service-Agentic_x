import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const compareToolDefinition: ChatCompletionTool = {
  type: "function",
  function: {
    name: "compare_salary",
    description:
      "Compare two payroll months for the same user from the database (basic, HRA, tax, PF, gross, net estimate).",
    parameters: {
      type: "object",
      properties: {
        month_a: {
          type: "string",
          description: 'First month key, e.g. "2025-03"',
        },
        month_b: {
          type: "string",
          description: 'Second month key, e.g. "2025-04"',
        },
      },
      required: ["month_a", "month_b"],
    },
  },
};

export interface CompareSalaryArgs {
  month_a: string;
  month_b: string;
}
