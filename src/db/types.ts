/** Row shape for Postgres table `Salary` (quoted identifier, camelCase `userId` column). */
export type SalaryRow = {
  id: number;
  userId: string;
  month: string;
  basic: number;
  hra: number;
  tax: number;
  pf: number;
};

/** Kept as alias where the codebase referred to Prisma `Salary`. */
export type Salary = SalaryRow;
