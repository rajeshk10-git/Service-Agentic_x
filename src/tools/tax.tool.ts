import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const taxToolDefinition: ChatCompletionTool = {
  type: "function",
  function: {
    name: "calculate_tax",
    description:
      "Estimate Indian income tax (FY 2025-26 slabs) in-process: old or new regime, Section 87A rebate, 4% cess. Provide annual_gross (INR) and regime.",
    parameters: {
      type: "object",
      properties: {
        annual_gross: {
          type: "number",
          description: "Estimated annual gross income in INR (before regime-specific deductions)",
        },
        regime: {
          type: "string",
          enum: ["old", "new"],
          description: "Tax regime (new: mainly standard deduction; old: 80C, 80D, HRA, etc.)",
        },
        standard_deduction: {
          type: "number",
          description: "Optional: standard deduction (new regime typically ₹50k salaried; old if applicable)",
        },
        section_80c: {
          type: "number",
          description: "Optional: Section 80C (old regime)",
        },
        section_80d: {
          type: "number",
          description: "Optional: Section 80D health insurance (old regime)",
        },
        hra: {
          type: "number",
          description: "Optional: HRA exemption amount (old regime)",
        },
        lta: {
          type: "number",
          description: "Optional: LTA exemption (old regime)",
        },
        housing_loan_interest: {
          type: "number",
          description: "Optional: housing loan interest deduction (old regime)",
        },
        other: {
          type: "number",
          description: "Optional: other Chapter VI-A deductions total (old regime)",
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
  section_80d?: number;
  hra?: number;
  lta?: number;
  housing_loan_interest?: number;
  other?: number;
}
