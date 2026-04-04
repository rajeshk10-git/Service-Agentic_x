import type { protos } from "@google-cloud/documentai";

type DocEntity = protos.google.cloud.documentai.v1.Document.IEntity;

/** Money in normalizedValue (proto may use Long for units/nanos). */
type MoneyLike = {
  currencyCode?: string | null;
  units?: unknown;
  nanos?: unknown;
};

type DateValue = {
  year?: number | string | null;
  month?: number | string | null;
  day?: number | string | null;
};

export type DocumentAiPayslipExtracted = {
  month: string | null;
  basic: number | null;
  hra: number | null;
  tax: number | null;
  pf: number | null;
  grossEarnings: number | null;
  netPay: number | null;
  payDate: string | null;
  payPeriodLabel: string | null;
  employeeName: string | null;
  employerName: string | null;
};

function numFromUnits(u: unknown): number {
  if (u == null) return 0;
  if (typeof u === "number") return u;
  if (typeof u === "string") return Number(u) || 0;
  if (typeof u === "object" && u !== null && "toNumber" in u) {
    try {
      return (u as { toNumber: () => number }).toNumber();
    } catch {
      return 0;
    }
  }
  return Number(u) || 0;
}

function moneyToNumber(m?: MoneyLike | null): number | undefined {
  if (!m) return undefined;
  const units = numFromUnits(m.units);
  const nanos = numFromUnits(m.nanos) / 1e9;
  return units + nanos;
}

function moneyFromEntity(e?: DocEntity | null): number | undefined {
  const mv = e?.normalizedValue?.moneyValue;
  return moneyToNumber(mv ?? undefined);
}

function monthKeyFromDateValue(d?: DateValue | null): string | null {
  const y = numFromUnits(d?.year);
  const m = numFromUnits(d?.month);
  if (!y || !m) return null;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function monthFromEntity(e?: DocEntity | null): string | null {
  const nv = e?.normalizedValue;
  if (!nv) return null;
  const text = nv.text?.trim();
  if (text && /^\d{4}-\d{2}$/.test(text)) return text;
  if (text && /^\d{4}-\d{2}-\d{2}$/.test(text)) return text.slice(0, 7);
  return monthKeyFromDateValue(nv.dateValue ?? null);
}

function findProp(parent: DocEntity, propType: string): DocEntity | undefined {
  return parent.properties?.find((p) => p.type === propType);
}

function labelFromProp(parent: DocEntity, propType: string): string {
  const p = findProp(parent, propType);
  return (p?.mentionText ?? p?.textAnchor?.content ?? "").trim().toLowerCase();
}

/**
 * Maps custom-processor entities (earning_item, tax_item, deduction_item, etc.)
 * into fields compatible with `salaries` (basic, hra, tax, pf, month YYYY-MM); unknown amounts stay null when upserting.
 */
export function extractPayslipFromDocumentAi(
  doc: protos.google.cloud.documentai.v1.IDocument | null | undefined,
): DocumentAiPayslipExtracted {
  const out: DocumentAiPayslipExtracted = {
    month: null,
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

  const entities = doc?.entities ?? [];
  let taxTotal = 0;
  let taxSeen = false;
  let pfTotal = 0;
  let pfSeen = false;

  for (const e of entities) {
    const t = e.type ?? "";

    switch (t) {
      case "earning_item": {
        const label = labelFromProp(e, "earning_type");
        const amt =
          moneyFromEntity(findProp(e, "earning_this_period")) ??
          moneyFromEntity(e);
        if (amt == null) break;
        if (label.includes("basic")) {
          out.basic = amt;
        } else if (
          label.includes("hra") ||
          label.includes("allowance") ||
          label.includes("house")
        ) {
          out.hra = (out.hra ?? 0) + amt;
        }
        break;
      }
      case "tax_item": {
        const amt =
          moneyFromEntity(findProp(e, "tax_this_period")) ??
          moneyFromEntity(e);
        if (amt != null) {
          taxTotal += amt;
          taxSeen = true;
        }
        break;
      }
      case "deduction_item": {
        const label = labelFromProp(e, "deduction_type");
        const amt =
          moneyFromEntity(findProp(e, "deduction_this_period")) ??
          moneyFromEntity(e);
        if (amt == null) break;
        if (
          label.includes("provident") ||
          label.includes("pf") ||
          label.includes("epf")
        ) {
          pfTotal += amt;
          pfSeen = true;
        }
        break;
      }
      case "net_pay":
        out.netPay = moneyFromEntity(e) ?? out.netPay;
        break;
      case "gross_earnings":
        out.grossEarnings = moneyFromEntity(e) ?? out.grossEarnings;
        break;
      case "pay_date": {
        const nv = e.normalizedValue;
        const dv = nv?.dateValue;
        const y = dv ? numFromUnits(dv.year) : 0;
        const mo = dv ? numFromUnits(dv.month) : 0;
        const day = dv ? numFromUnits(dv.day) || 1 : 1;
        out.payDate =
          nv?.text?.trim() ??
          (y && mo
            ? `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`
            : null);
        break;
      }
      case "start_date":
        out.payPeriodLabel = e.mentionText?.trim() ?? null;
        out.month = monthFromEntity(e) ?? out.month;
        break;
      case "employee_name":
        out.employeeName = e.mentionText?.trim() ?? null;
        break;
      case "employer_name":
        out.employerName = e.mentionText?.trim() ?? null;
        break;
      default:
        break;
    }
  }

  if (taxSeen) out.tax = taxTotal;
  if (pfSeen) out.pf = pfTotal;

  if (!out.month) {
    for (const e of entities) {
      if (e.type === "pay_date") {
        const m = monthFromEntity(e);
        if (m) {
          out.month = m;
          break;
        }
      }
    }
  }

  return out;
}

export function payslipExtractReadyForSalary(
  x: DocumentAiPayslipExtracted,
): x is DocumentAiPayslipExtracted & { month: string; basic: number } {
  return Boolean(x.month && x.basic != null && !Number.isNaN(x.basic));
}

function parseFlexibleMonth(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  if (/^\d{4}-\d{2}$/.test(t)) return t;
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(t);
  if (m) return `${m[1]}-${m[2]}`;
  return t;
}

/** Maps JSON from Gemini `generateContent` into the same shape as Document AI extraction. */
export function payslipExtractedFromGeminiJson(
  raw: unknown,
): DocumentAiPayslipExtracted {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const num = (k: string): number | null => {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const cleaned = v.replace(/[,₹$€£\s]/g, "");
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  const str = (k: string): string | null => {
    const v = o[k];
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length ? s : null;
  };

  return {
    month: parseFlexibleMonth(str("month")),
    basic: num("basic"),
    hra: num("hra"),
    tax: num("tax"),
    pf: num("pf"),
    grossEarnings: num("grossEarnings"),
    netPay: num("netPay"),
    payDate: str("payDate"),
    payPeriodLabel: str("payPeriodLabel"),
    employeeName: str("employeeName"),
    employerName: str("employerName"),
  };
}
