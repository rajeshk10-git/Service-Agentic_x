import type { protos } from "@google-cloud/documentai";
import {
  extractPayslipFromDocumentAi,
  payslipExtractReadyForSalary,
  payslipExtractedFromGeminiJson,
} from "./documentai.extract";

type DocEntity = protos.google.cloud.documentai.v1.Document.IEntity;

function entity(
  type: string,
  overrides: Partial<DocEntity> = {},
): DocEntity {
  return { type, ...overrides };
}

function moneyEntity(
  type: string,
  units: number,
  propType?: string,
  propLabel?: string,
): DocEntity {
  const base: DocEntity = {
    type,
    normalizedValue: { moneyValue: { currencyCode: "INR", units, nanos: 0 } },
  };
  if (propType && propLabel) {
    base.properties = [
      { type: propType, mentionText: propLabel },
      {
        type: propType.replace("_type", "_this_period"),
        normalizedValue: {
          moneyValue: { currencyCode: "INR", units, nanos: 0 },
        },
      },
    ];
  }
  return base;
}

describe("extractPayslipFromDocumentAi", () => {
  it("returns all-null for null doc", () => {
    const result = extractPayslipFromDocumentAi(null);
    expect(result.month).toBeNull();
    expect(result.basic).toBeNull();
    expect(result.hra).toBeNull();
    expect(result.tax).toBeNull();
    expect(result.pf).toBeNull();
    expect(result.netPay).toBeNull();
    expect(result.grossEarnings).toBeNull();
  });

  it("returns all-null for doc with no entities", () => {
    const result = extractPayslipFromDocumentAi({ entities: [] });
    expect(result.basic).toBeNull();
    expect(result.tax).toBeNull();
  });

  it("extracts basic from earning_item with label containing 'basic'", () => {
    const doc = {
      entities: [
        moneyEntity("earning_item", 50000, "earning_type", "Basic Pay"),
      ],
    };
    const result = extractPayslipFromDocumentAi(doc);
    expect(result.basic).toBe(50000);
  });

  it("extracts hra from earning_item with label containing 'hra'", () => {
    const doc = {
      entities: [
        moneyEntity("earning_item", 20000, "earning_type", "HRA"),
      ],
    };
    const result = extractPayslipFromDocumentAi(doc);
    expect(result.hra).toBe(20000);
  });

  it("accumulates multiple hra-like items", () => {
    const doc = {
      entities: [
        moneyEntity("earning_item", 10000, "earning_type", "HRA"),
        moneyEntity("earning_item", 5000, "earning_type", "House Allowance"),
      ],
    };
    const result = extractPayslipFromDocumentAi(doc);
    expect(result.hra).toBe(15000);
  });

  it("accumulates tax from multiple tax_items", () => {
    const doc = {
      entities: [
        moneyEntity("tax_item", 3000, "tax_type", "TDS"),
        moneyEntity("tax_item", 500, "tax_type", "Cess"),
      ],
    };
    const result = extractPayslipFromDocumentAi(doc);
    expect(result.tax).toBe(3500);
  });

  it("extracts pf from deduction_item with label containing 'pf'", () => {
    const doc = {
      entities: [
        moneyEntity("deduction_item", 1800, "deduction_type", "EPF"),
      ],
    };
    const result = extractPayslipFromDocumentAi(doc);
    expect(result.pf).toBe(1800);
  });

  it("extracts net_pay", () => {
    const doc = {
      entities: [
        {
          type: "net_pay",
          normalizedValue: {
            moneyValue: { currencyCode: "INR", units: 45000, nanos: 0 },
          },
        } as DocEntity,
      ],
    };
    const result = extractPayslipFromDocumentAi(doc);
    expect(result.netPay).toBe(45000);
  });

  it("extracts gross_earnings", () => {
    const doc = {
      entities: [
        {
          type: "gross_earnings",
          normalizedValue: {
            moneyValue: { currencyCode: "INR", units: 70000, nanos: 0 },
          },
        } as DocEntity,
      ],
    };
    const result = extractPayslipFromDocumentAi(doc);
    expect(result.grossEarnings).toBe(70000);
  });

  it("extracts employee_name and employer_name", () => {
    const doc = {
      entities: [
        entity("employee_name", { mentionText: "  John Doe  " }),
        entity("employer_name", { mentionText: "  Acme Corp  " }),
      ],
    };
    const result = extractPayslipFromDocumentAi(doc);
    expect(result.employeeName).toBe("John Doe");
    expect(result.employerName).toBe("Acme Corp");
  });

  it("extracts month from start_date entity", () => {
    const doc = {
      entities: [
        {
          type: "start_date",
          mentionText: "Jan 2025",
          normalizedValue: {
            text: "2025-01-01",
            dateValue: { year: 2025, month: 1, day: 1 },
          },
        } as DocEntity,
      ],
    };
    const result = extractPayslipFromDocumentAi(doc);
    expect(result.month).toBe("2025-01");
  });

  it("falls back to pay_date for month when start_date has no month", () => {
    const doc = {
      entities: [
        {
          type: "pay_date",
          normalizedValue: {
            text: "2025-03-15",
            dateValue: { year: 2025, month: 3, day: 15 },
          },
        } as DocEntity,
      ],
    };
    const result = extractPayslipFromDocumentAi(doc);
    expect(result.month).toBe("2025-03");
    expect(result.payDate).toBe("2025-03-15");
  });
});

describe("payslipExtractReadyForSalary", () => {
  it("returns true when month and basic are present", () => {
    const extracted = {
      month: "2025-01",
      basic: 50000,
      hra: null,
      tax: null,
      pf: null,
      grossEarnings: null,
      netPay: null,
      payDate: null,
      payPeriodLabel: null,
      employeeName: null,
      employerName: null,
    };
    expect(payslipExtractReadyForSalary(extracted)).toBe(true);
  });

  it("returns false when month is null", () => {
    const extracted = {
      month: null,
      basic: 50000,
      hra: null,
      tax: null,
      pf: null,
      grossEarnings: null,
      netPay: null,
      payDate: null,
      payPeriodLabel: null,
      employeeName: null,
      employerName: null,
    };
    expect(payslipExtractReadyForSalary(extracted)).toBe(false);
  });

  it("returns false when basic is null", () => {
    const extracted = {
      month: "2025-01",
      basic: null,
      hra: null,
      tax: null,
      pf: null,
      grossEarnings: null,
      netPay: null,
      payDate: null,
      payPeriodLabel: null,
      employeeName: null,
      employerName: null,
    };
    expect(payslipExtractReadyForSalary(extracted)).toBe(false);
  });
});

describe("payslipExtractedFromGeminiJson", () => {
  it("maps a well-formed Gemini JSON to extraction result", () => {
    const raw = {
      month: "2025-03",
      basic: 60000,
      hra: 25000,
      tax: 5000,
      pf: 2000,
      grossEarnings: 85000,
      netPay: 78000,
      payDate: "2025-03-28",
      payPeriodLabel: "March 2025",
      employeeName: "Jane Doe",
      employerName: "Acme Inc",
    };
    const result = payslipExtractedFromGeminiJson(raw);
    expect(result.month).toBe("2025-03");
    expect(result.basic).toBe(60000);
    expect(result.hra).toBe(25000);
    expect(result.tax).toBe(5000);
    expect(result.pf).toBe(2000);
    expect(result.employeeName).toBe("Jane Doe");
  });

  it("parses currency-formatted strings", () => {
    const raw = { basic: "₹60,000", hra: "$25,000.50" };
    const result = payslipExtractedFromGeminiJson(raw);
    expect(result.basic).toBe(60000);
    expect(result.hra).toBe(25000.50);
  });

  it("handles null/undefined input", () => {
    const result = payslipExtractedFromGeminiJson(null);
    expect(result.month).toBeNull();
    expect(result.basic).toBeNull();
  });

  it("handles array input gracefully", () => {
    const result = payslipExtractedFromGeminiJson([1, 2, 3]);
    expect(result.month).toBeNull();
    expect(result.basic).toBeNull();
  });

  it("normalizes YYYY-MM-DD month to YYYY-MM", () => {
    const result = payslipExtractedFromGeminiJson({ month: "2025-03-15" });
    expect(result.month).toBe("2025-03");
  });

  it("passes through YYYY-MM month unchanged", () => {
    const result = payslipExtractedFromGeminiJson({ month: "2025-03" });
    expect(result.month).toBe("2025-03");
  });

  it("returns null for non-numeric string in number fields", () => {
    const result = payslipExtractedFromGeminiJson({ basic: "not-a-number" });
    expect(result.basic).toBeNull();
  });
});
