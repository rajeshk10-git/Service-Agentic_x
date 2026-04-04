import axios, { AxiosError } from "axios";
import { env } from "../config/env";
import type { Deductions } from "./tax.service";
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
import type { CalculateTaxArgs } from "../tools/tax.tool";
import type { CompareSalaryArgs } from "../tools/compare.tool";
import type { GetSalaryDataArgs } from "../tools/salary.tool";
import type { ParseSalarySlipArgs } from "../tools/parse.tool";
import { payrollService } from "./payroll.service";
import { ragService } from "./rag.service";

export type ToolName =
  | "calculate_tax"
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
    s === "compare_salary" ||
    s === "parse_salary_slip" ||
    s === "get_salary_data"
  );
}

export function parseToolName(name: string): ToolName | null {
  return isToolName(name) ? name : null;
}
