// Indian Income Tax Calculation Service (FY 2025-26)
// Supports Old and New regimes, deductions, and rebate 87A

export type TaxRegime = "old" | "new";

export interface Deductions {
  standardDeduction?: number;
  section80C?: number;
  section80D?: number;
  hra?: number;
  lta?: number;
  housingLoanInterest?: number;
  other?: number;
}

export interface TaxResult {
  taxableIncome: number;
  regime: TaxRegime;
  taxBeforeRebate: number;
  rebate87A: number;
  taxAfterRebate: number;
  cess: number;
  totalTax: number;
  breakdown: { slab: string; amount: number }[];
}

export class TaxService {
  private readonly newRegimeSlabs = [
    { upTo: 300_000, rate: 0 },
    { upTo: 700_000, rate: 0.05 },
    { upTo: 1_000_000, rate: 0.1 },
    { upTo: 1_200_000, rate: 0.15 },
    { upTo: 1_500_000, rate: 0.2 },
    { upTo: Infinity, rate: 0.3 },
  ];

  private readonly oldRegimeSlabs = [
    { upTo: 250_000, rate: 0 },
    { upTo: 500_000, rate: 0.05 },
    { upTo: 1_000_000, rate: 0.2 },
    { upTo: Infinity, rate: 0.3 },
  ];

  calculateTax(
    income: number,
    deductions: Deductions = {},
    regime: TaxRegime = "new",
  ): TaxResult {
    let taxableIncome = income;
    if (regime === "old") {
      const totalDeductions =
        (deductions.standardDeduction ?? 0) +
        (deductions.section80C ?? 0) +
        (deductions.section80D ?? 0) +
        (deductions.hra ?? 0) +
        (deductions.lta ?? 0) +
        (deductions.housingLoanInterest ?? 0) +
        (deductions.other ?? 0);

      taxableIncome = Math.max(income - totalDeductions, 0);
    } else {
      taxableIncome = Math.max(
        income - (deductions.standardDeduction ?? 0),
        0,
      );
    }

    const slabs = regime === "old" ? this.oldRegimeSlabs : this.newRegimeSlabs;

    let tax = 0;
    let prevLimit = 0;
    const breakdown: { slab: string; amount: number }[] = [];

    for (const slab of slabs) {
      if (taxableIncome > slab.upTo) {
        const slabTax = (slab.upTo - prevLimit) * slab.rate;
        tax += slabTax;
        breakdown.push({
          slab: `${prevLimit + 1} - ${slab.upTo}`,
          amount: slabTax,
        });
        prevLimit = slab.upTo;
      } else {
        const slabTax = (taxableIncome - prevLimit) * slab.rate;
        tax += slabTax;
        breakdown.push({
          slab: `${prevLimit + 1} - ${taxableIncome}`,
          amount: slabTax,
        });
        break;
      }
    }

    let rebate87A = 0;
    if (regime === "new" && taxableIncome <= 700_000) {
      rebate87A = tax;
    } else if (regime === "old" && taxableIncome <= 500_000) {
      rebate87A = Math.min(tax, 12_500);
    }

    const taxAfterRebate = Math.max(tax - rebate87A, 0);

    const cess = taxAfterRebate * 0.04;
    const totalTax = taxAfterRebate + cess;

    return {
      taxableIncome,
      regime,
      taxBeforeRebate: tax,
      rebate87A,
      taxAfterRebate,
      cess,
      totalTax,
      breakdown,
    };
  }
}

export const taxService = new TaxService();
