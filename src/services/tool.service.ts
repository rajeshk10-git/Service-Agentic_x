import axios, { AxiosError } from "axios";
import { env } from "../config/env";
import type { Deductions, DeductionsWithout80C } from "./tax.service";
import { taxService } from "./tax.service";
import {
  canProcessPayslipFromBytes,
  isDocumentAiConfigured,
  processDocumentFromBytes,
  processDocumentFromGcs,
} from "../gcp/documentai.service";
import {
  payslipExtractReadyForSalary,
  type DocumentAiPayslipExtracted,
} from "../gcp/documentai.extract";
import { enqueueParseJob, isCloudTasksConfigured } from "../gcp/cloud-tasks.service";
import type {
  CalculateTaxArgs,
  CompareTaxRegimesArgs,
  SimulateTaxArgs,
} from "../tools/tax.tool";
import type { CompareSalaryArgs } from "../tools/compare.tool";
import type { GetSalaryDataArgs } from "../tools/salary.tool";
import type { ParseSalarySlipArgs } from "../tools/parse.tool";
import { payrollService } from "./payroll.service";
import { ragService } from "./rag.service";

export type ToolName =
  | "calculate_tax"
  | "simulate_tax"
  | "compare_tax_regimes"
  | "compare_salary"
  | "parse_salary_slip"
  | "get_salary_data";

export class ToolService {
  async executeTool(
    name: ToolName,
    args: unknown,
    userId: string,
  ): Promise<unknown> {
    switch (name) {
      case "calculate_tax":
        return this.calculateTax(args as CalculateTaxArgs);
      case "simulate_tax":
        return this.simulateTax(args as SimulateTaxArgs);
      case "compare_tax_regimes":
        return this.compareTaxRegimes(args as CompareTaxRegimesArgs);
      case "compare_salary":
        return this.compareSalary(args as CompareSalaryArgs, userId);
      case "parse_salary_slip":
        return this.parseSalarySlip(args as ParseSalarySlipArgs, userId);
      case "get_salary_data":
        return this.getSalaryData(args as GetSalaryDataArgs, userId);
      default:
        return {
          error: true,
          message: `Unknown tool: ${String(name)}`,
        };
    }
  }

  /** Used by Cloud Tasks worker — same tool logic, no re-queue. */
  async runParseForWorker(
    args: ParseSalarySlipArgs,
    userId: string,
  ): Promise<unknown> {
    return this.parseSalarySlipBody(args, userId, { allowQueue: false });
  }

  /**
   * Inline payslip bytes (e.g. multipart upload on /agent/query) — Document AI + same persistence as gcs_uri parse.
   */
  async processUploadedPayslipWithDocumentAi(
    userId: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<Record<string, unknown>> {
    if (!canProcessPayslipFromBytes()) {
      return {
        error: true,
        message:
          "Inline payslip parsing requires GOOGLE_AI_API_KEY or GEMINI_API_KEY (Gemini generateContent).",
      };
    }
    try {
      console.log('START Q');
      const da = await processDocumentFromBytes(buffer, mimeType);
      console.log('END Q');
      return await this.finalizeDocumentAiParse(userId, da);
    } catch (err) {
      return {
        error: true,
        tool: "parse_salary_slip",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async finalizeDocumentAiParse(
    userId: string,
    da: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (da.error) {
      return da;
    }

    const extracted = da.extracted as DocumentAiPayslipExtracted | undefined;
    if (extracted && payslipExtractReadyForSalary(extracted)) {
      const { saved, salary } =
        await payrollService.upsertSalaryFromExtract(userId, extracted);
      if (saved) {
        da.salarySaved = true;
        if (salary?.id) {
          da.salaryId = salary.id;
        }
        const records = await payrollService.getSalaryByUserId(userId);
        await ragService.indexFromSalaryRecords(userId, records);
      }
    }

    return da;
  }

  private async calculateTax(args: CalculateTaxArgs): Promise<unknown> {
    try {
      if (
        typeof args.annual_gross !== "number" ||
        Number.isNaN(args.annual_gross) ||
        args.annual_gross < 0
      ) {
        return {
          error: true,
          message: "annual_gross must be a non-negative number",
        };
      }
      const deductions: Deductions = {
        standardDeduction: args.standard_deduction,
        section80C: args.section_80c,
        section80D: args.section_80d,
        hra: args.hra,
        lta: args.lta,
        housingLoanInterest: args.housing_loan_interest,
        other: args.other,
      };
      const result = taxService.calculateTax(
        args.annual_gross,
        deductions,
        args.regime,
      );
      return {
        ...result,
        source: "tax_service",
        financial_year: "2025-26",
        note: "Indicative only; verify with a qualified tax advisor.",
      };
    } catch (err) {
      return {
        error: true,
        tool: "calculate_tax",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async simulateTax(args: SimulateTaxArgs): Promise<unknown> {
    try {
      if (
        typeof args.annual_gross !== "number" ||
        Number.isNaN(args.annual_gross) ||
        args.annual_gross < 0
      ) {
        return {
          error: true,
          message: "annual_gross must be a non-negative number",
        };
      }

      const otherDeductions: DeductionsWithout80C = {
        standardDeduction: args.standard_deduction,
        section80D: args.section_80d,
        hra: args.hra,
        lta: args.lta,
        housingLoanInterest: args.housing_loan_interest,
        other: args.other,
      };

      const hasProposed =
        typeof args.section_80c_proposed === "number" &&
        !Number.isNaN(args.section_80c_proposed);

      const maximize80C =
        args.maximize_80c === true
          ? true
          : hasProposed
            ? false
            : true;

      const proposed80C = hasProposed ? args.section_80c_proposed : undefined;

      const raw = taxService.simulateSection80CSavings(
        args.annual_gross,
        args.regime,
        otherDeductions,
        { maximize80C, proposed80C },
      );

      if (raw.kind === "new_regime_no_80c") {
        return {
          tool: "simulate_tax",
          source: "tax_service",
          financial_year: "2025-26",
          kind: raw.kind,
          message: raw.message,
          tax_estimate: raw.tax_estimate,
          note: "Indicative only; verify with a qualified tax advisor.",
        };
      }

      return {
        tool: "simulate_tax",
        source: "tax_service",
        financial_year: "2025-26",
        kind: raw.kind,
        annual_gross: raw.annual_gross,
        section_80c_cap_inr: raw.section_80c_cap_inr,
        section_80c_modeled: raw.section_80c_modeled,
        baseline_no_80c: raw.baseline_zero_80c,
        with_modeled_80c: raw.with_section_80c,
        total_tax_savings_inr: raw.total_tax_savings,
        note:
          "Savings = total tax (including cess) with ₹0 under 80C minus total tax with modeled 80C, old regime only. Assumes no other 80C is already claimed. Indicative only.",
      };
    } catch (err) {
      return {
        error: true,
        tool: "simulate_tax",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private resolveStandardDeduction(
    value: number | undefined,
    defaultInr: number,
  ): number {
    if (typeof value === "number" && !Number.isNaN(value)) {
      return value;
    }
    return defaultInr;
  }

  private async compareTaxRegimes(
    args: CompareTaxRegimesArgs,
  ): Promise<unknown> {
    try {
      if (
        typeof args.annual_gross !== "number" ||
        Number.isNaN(args.annual_gross) ||
        args.annual_gross < 0
      ) {
        return {
          error: true,
          message: "annual_gross must be a non-negative number",
        };
      }

      const oldStd = this.resolveStandardDeduction(
        args.standard_deduction_old,
        50_000,
      );
      const newStd = this.resolveStandardDeduction(
        args.new_regime_standard_deduction,
        50_000,
      );

      const oldDeductions: Deductions = {
        standardDeduction: oldStd,
        section80C: args.section_80c,
        section80D: args.section_80d,
        hra: args.hra,
        lta: args.lta,
        housingLoanInterest: args.housing_loan_interest,
        other: args.other,
      };

      const raw = taxService.compareRegimes(
        args.annual_gross,
        oldDeductions,
        newStd,
      );

      return {
        tool: "compare_tax_regimes",
        source: "tax_service",
        financial_year: "2025-26",
        annual_gross: raw.annual_gross,
        assumptions: {
          standard_deduction_old_inr: oldStd,
          new_regime_standard_deduction_inr: newStd,
          old_regime_includes_80c_80d_hra_etc_as_provided: true,
          new_regime_only_standard_deduction_in_model: true,
        },
        old_regime: raw.old_regime,
        new_regime: raw.new_regime,
        lower_tax_regime: raw.lower_tax_regime,
        annual_tax_savings_inr_if_choose_lower:
          raw.annual_tax_savings_inr_if_choose_lower,
        old_minus_new_total_tax: raw.old_minus_new_total_tax,
        note: "Indicative only; actual choice depends on full return, rebates, and law. Consult a qualified tax advisor.",
      };
    } catch (err) {
      return {
        error: true,
        tool: "compare_tax_regimes",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async parseSalarySlip(
    args: ParseSalarySlipArgs,
    userId: string,
  ): Promise<unknown> {
    return this.parseSalarySlipBody(args, userId, { allowQueue: true });
  }

  private async parseSalarySlipBody(
    args: ParseSalarySlipArgs,
    userId: string,
    opts: { allowQueue: boolean },
  ): Promise<unknown> {
    const hasGcs = Boolean(args.gcs_uri?.trim());
    const hasText = Boolean(args.document_text?.trim());

    if (!hasGcs && !hasText) {
      return {
        error: true,
        message: "Provide gcs_uri (for Document AI) or document_text (for Python parser).",
      };
    }

    if (
      opts.allowQueue &&
      args.async === true &&
      isCloudTasksConfigured()
    ) {
      const q = await enqueueParseJob({
        userId,
        gcsUri: args.gcs_uri,
        documentText: args.document_text,
        contentType: args.content_type,
      });
      if ("error" in q) {
        return { error: true, message: q.error };
      }
      return {
        queued: true,
        taskName: q.name,
        message:
          "Payslip parse queued. Results will be available for follow-up questions after the worker runs.",
      };
    }

    if (hasGcs && isDocumentAiConfigured()) {
      try {
        const da = await processDocumentFromGcs(args.gcs_uri!.trim());
        return await this.finalizeDocumentAiParse(userId, da);
      } catch (err) {
        return {
          error: true,
          tool: "parse_salary_slip",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    if (hasText) {
      try {
        const url = `${env.PYTHON_PARSE_SERVICE_URL.replace(/\/$/, "")}/parse`;
        const body =
          args.content_type === "json"
            ? { raw_json: args.document_text }
            : { text: args.document_text };
        const { data } = await axios.post(url, body, {
          timeout: 60_000,
          headers: { "Content-Type": "application/json" },
          validateStatus: () => true,
        });

        return data;
      } catch (err) {
        return this.formatAxiosError("parse_salary_slip", err);
      }
    }

    return {
      error: true,
      message:
        "gcs_uri was provided but Document AI is not configured (set DOCUMENT_AI_PROCESSOR_ID), or no usable document_text for the Python parser.",
    };
  }

  private async compareSalary(
    args: CompareSalaryArgs,
    userId: string,
  ): Promise<unknown> {
    try {
      const result = await payrollService.compareTwoMonths(
        userId,
        args.month_a,
        args.month_b,
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        error: true,
        tool: "compare_salary",
        message,
      };
    }
  }

  private async getSalaryData(
    args: GetSalaryDataArgs,
    userId: string,
  ): Promise<unknown> {
    if (args.month) {
      const row = await payrollService.getSalaryByMonth(userId, args.month);
      if (!row) {
        return {
          error: true,
          message: `No salary data for user in month ${args.month}`,
        };
      }
      return { records: [row] };
    }
    const records = await payrollService.getSalaryByUserId(userId);
    if (records.length === 0) {
      return {
        error: true,
        message: "No salary data on file for this user.",
      };
    }
    return { records };
  }

  private formatAxiosError(tool: string, err: unknown): Record<string, unknown> {
    if (axios.isAxiosError(err)) {
      const ax = err as AxiosError<{ detail?: string; message?: string }>;
      const remote =
        ax.response?.data &&
        typeof ax.response.data === "object" &&
        ("detail" in ax.response.data || "message" in ax.response.data)
          ? String(
              (ax.response.data as { detail?: string; message?: string })
                .detail ??
                (ax.response.data as { message?: string }).message,
            )
          : undefined;
      return {
        error: true,
        tool,
        message:
          remote ??
          ax.message ??
          "Downstream service unreachable or returned an error.",
        status: ax.response?.status,
      };
    }
    return {
      error: true,
      tool,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export const toolService = new ToolService();

function isToolName(s: string): s is ToolName {
  return (
    s === "calculate_tax" ||
    s === "simulate_tax" ||
    s === "compare_tax_regimes" ||
    s === "compare_salary" ||
    s === "parse_salary_slip" ||
    s === "get_salary_data"
  );
}

export function parseToolName(name: string): ToolName | null {
  return isToolName(name) ? name : null;
}
