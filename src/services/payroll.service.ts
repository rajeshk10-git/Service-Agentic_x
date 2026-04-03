import type { Salary } from "@prisma/client";
import { prisma } from "../db/prisma";
import type { DocumentAiPayslipExtracted } from "../gcp/documentai.extract";

export interface SalaryComparison {
  month_a: string;
  month_b: string;
  month_a_record: Salary;
  month_b_record: Salary;
  deltas: {
    basic: number;
    hra: number;
    tax: number;
    pf: number;
    gross: number;
    net_estimate: number;
  };
}

function grossNet(s: Salary): { gross: number; net_estimate: number } {
  const gross = s.basic + s.hra;
  const net_estimate = gross - s.tax - s.pf;
  return { gross, net_estimate };
}

export class PayrollService {
  async getSalaryByUserId(userId: string): Promise<Salary[]> {
    return prisma.salary.findMany({
      where: { userId },
      orderBy: { month: "asc" },
    });
  }

  async getSalaryByMonth(
    userId: string,
    month: string,
  ): Promise<Salary | null> {
    return prisma.salary.findFirst({
      where: { userId, month },
    });
  }

  /**
   * Upsert a `Salary` row from Document AI payslip extraction (month YYYY-MM + basic required).
   */
  async upsertSalaryFromExtract(
    userId: string,
    extracted: DocumentAiPayslipExtracted,
  ): Promise<{ saved: boolean; salary?: Salary }> {
    const month = extracted.month;
    const basic = extracted.basic;
    if (!month || basic == null || Number.isNaN(basic)) {
      return { saved: false };
    }
    const hra = extracted.hra ?? 0;
    const tax = extracted.tax ?? 0;
    const pf = extracted.pf ?? 0;

    const existing = await prisma.salary.findFirst({
      where: { userId, month },
    });

    const salary = existing
      ? await prisma.salary.update({
          where: { id: existing.id },
          data: { basic, hra, tax, pf },
        })
      : await prisma.salary.create({
          data: { userId, month, basic, hra, tax, pf },
        });

    return { saved: true, salary };
  }

  async compareTwoMonths(
    userId: string,
    monthA: string,
    monthB: string,
  ): Promise<SalaryComparison> {
    const [a, b] = await Promise.all([
      this.getSalaryByMonth(userId, monthA),
      this.getSalaryByMonth(userId, monthB),
    ]);

    if (!a) {
      throw new Error(`No salary record for month ${monthA}`);
    }
    if (!b) {
      throw new Error(`No salary record for month ${monthB}`);
    }

    const ga = grossNet(a);
    const gb = grossNet(b);

    return {
      month_a: monthA,
      month_b: monthB,
      month_a_record: a,
      month_b_record: b,
      deltas: {
        basic: b.basic - a.basic,
        hra: b.hra - a.hra,
        tax: b.tax - a.tax,
        pf: b.pf - a.pf,
        gross: gb.gross - ga.gross,
        net_estimate: gb.net_estimate - ga.net_estimate,
      },
    };
  }
}

export const payrollService = new PayrollService();
