import { getPool } from "../db/pool";
import type { Salary, SalaryRow } from "../db/types";
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

function mapSalary(r: {
  id: unknown;
  user_id: unknown;
  month: unknown;
  basic: unknown;
  hra: unknown;
  tax: unknown;
  pf: unknown;
}): SalaryRow {
  return {
    id: Number(r.id),
    userId: String(r.user_id),
    month: String(r.month),
    basic: Number(r.basic),
    hra: Number(r.hra),
    tax: Number(r.tax),
    pf: Number(r.pf),
  };
}

function grossNet(s: Salary): { gross: number; net_estimate: number } {
  const gross = s.basic + s.hra;
  const net_estimate = gross - s.tax - s.pf;
  return { gross, net_estimate };
}

export class PayrollService {
  async getSalaryByUserId(userId: string): Promise<Salary[]> {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, "userId" AS user_id, month, basic, hra, tax, pf
       FROM "Salary"
       WHERE "userId" = $1
       ORDER BY month ASC`,
      [userId],
    );
    return rows.map((r) => mapSalary(r));
  }

  async getSalaryByMonth(
    userId: string,
    month: string,
  ): Promise<Salary | null> {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, "userId" AS user_id, month, basic, hra, tax, pf
       FROM "Salary"
       WHERE "userId" = $1 AND month = $2
       LIMIT 1`,
      [userId, month],
    );
    return rows[0] ? mapSalary(rows[0]) : null;
  }

  /**
   * Upsert a `Salary` row from payslip extraction (month YYYY-MM + basic required).
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

    const pool = getPool();
    const existing = await pool.query(
      `SELECT id FROM "Salary" WHERE "userId" = $1 AND month = $2 LIMIT 1`,
      [userId, month],
    );

    if (existing.rows[0]) {
      const id = existing.rows[0].id as number;
      const { rows } = await pool.query(
        `UPDATE "Salary"
         SET basic = $1, hra = $2, tax = $3, pf = $4
         WHERE id = $5
         RETURNING id, "userId" AS user_id, month, basic, hra, tax, pf`,
        [basic, hra, tax, pf, id],
      );
      return { saved: true, salary: mapSalary(rows[0]) };
    }

    const { rows } = await pool.query(
      `INSERT INTO "Salary" ("userId", month, basic, hra, tax, pf)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, "userId" AS user_id, month, basic, hra, tax, pf`,
      [userId, month, basic, hra, tax, pf],
    );
    return { saved: true, salary: mapSalary(rows[0]) };
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
