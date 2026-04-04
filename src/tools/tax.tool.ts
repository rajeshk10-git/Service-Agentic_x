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

export const simulateTaxToolDefinition: ChatCompletionTool = {
  type: "function",
  function: {
    name: "simulate_tax",
    description:
      "What-if tax simulation (FY 2025-26): for OLD regime, compares total tax with Section 80C = ₹0 vs with 80C investment (capped at ₹1.5L) to show indicative tax savings. For NEW regime, 80C is not available — returns new-regime tax only and explains that 80C savings require old-regime simulation. Use when the user asks how much tax they can save by investing in 80C, ELSS, PPF, etc.",
    parameters: {
      type: "object",
      properties: {
        annual_gross: {
          type: "number",
          description: "Annual gross income in INR (before regime-specific deductions)",
        },
        regime: {
          type: "string",
          enum: ["old", "new"],
          description:
            "Which regime to discuss. Old = 80C simulation; new = no 80C in this model.",
        },
        maximize_80c: {
          type: "boolean",
          description:
            "If true (default when section_80c_proposed omitted), model full ₹1.5L 80C for maximum indicative savings under old regime.",
        },
        section_80c_proposed: {
          type: "number",
          description:
            "Planned 80C investment in INR (capped at ₹1.5L). Use with maximize_80c false for a specific amount.",
        },
        standard_deduction: {
          type: "number",
          description: "Optional: standard deduction (old regime)",
        },
        section_80d: {
          type: "number",
          description: "Optional: Section 80D (old regime), held constant across baseline vs 80C scenarios",
        },
        hra: {
          type: "number",
          description: "Optional: HRA exemption (old regime)",
        },
        lta: {
          type: "number",
          description: "Optional: LTA (old regime)",
        },
        housing_loan_interest: {
          type: "number",
          description: "Optional: housing loan interest (old regime)",
        },
        other: {
          type: "number",
          description: "Optional: other Chapter VI-A total (old regime), excluding 80C",
        },
      },
      required: ["annual_gross", "regime"],
    },
  },
};

export interface SimulateTaxArgs {
  annual_gross: number;
  regime: "old" | "new";
  maximize_80c?: boolean;
  section_80c_proposed?: number;
  standard_deduction?: number;
  section_80d?: number;
  hra?: number;
  lta?: number;
  housing_loan_interest?: number;
  other?: number;
}

const COMPARE_TAX_REGIME_DEDUCTION_PROPS = {
  standard_deduction_old: {
    type: "number",
    description:
      "Standard deduction for OLD regime (salaried default in tool handler: ₹50,000 if omitted).",
  },
  new_regime_standard_deduction: {
    type: "number",
    description:
      "Standard deduction for NEW regime only (default ₹50,000 if omitted — typical salaried).",
  },
  section_80c: {
    type: "number",
    description: "Section 80C (old regime only)",
  },
  section_80d: {
    type: "number",
    description: "Section 80D (old regime only)",
  },
  hra: {
    type: "number",
    description: "HRA exemption (old regime only)",
  },
  lta: {
    type: "number",
    description: "LTA exemption (old regime only)",
  },
  housing_loan_interest: {
    type: "number",
    description: "Housing loan interest (old regime only)",
  },
  other: {
    type: "number",
    description: "Other Chapter VI-A total (old regime only)",
  },
} as const;

export const compareTaxRegimesToolDefinition: ChatCompletionTool = {
  type: "function",
  function: {
    name: "compare_tax_regimes",
    description:
      "Compare FY 2025-26 total tax (incl. cess) under OLD vs NEW regime for the same annual gross. Returns both computations, which is cheaper, and indicative annual tax difference. Use when the user asks which regime is better, cheaper, or saves more tax. Pass all old-regime deductions the user claims (80C, HRA, etc.); new regime in this model uses only standard deduction.",
    parameters: {
      type: "object",
      properties: {
        annual_gross: {
          type: "number",
          description: "Annual gross income in INR (same basis for both regimes)",
        },
        ...COMPARE_TAX_REGIME_DEDUCTION_PROPS,
      },
      required: ["annual_gross"],
    },
  },
};

export interface CompareTaxRegimesArgs {
  annual_gross: number;
  standard_deduction_old?: number;
  new_regime_standard_deduction?: number;
  section_80c?: number;
  section_80d?: number;
  hra?: number;
  lta?: number;
  housing_loan_interest?: number;
  other?: number;
}
