import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const salaryToolDefinition: ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_salary_data",
    description:
      "Fetch stored payroll rows for the current user. Optionally filter by a single month (YYYY-MM).",
    parameters: {
      type: "object",
      properties: {
        month: {
          type: "string",
          description: 'Optional month filter, e.g. "2025-03"',
        },
      },
    },
  },
};

export interface GetSalaryDataArgs {
  month?: string;
}
