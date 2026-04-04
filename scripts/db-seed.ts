import "dotenv/config";
import pg from "pg";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url?.trim()) {
    throw new Error("DATABASE_URL is required");
  }
  const pool = new pg.Pool({ connectionString: url });
  try {
    await pool.query(`DELETE FROM salaries WHERE user_id = $1`, ["demo-user"]);
    await pool.query(
      `INSERT INTO salaries (
        user_id, year, month,
        basic, hra, income_tax_tds, employee_pf,
        total_earnings, net_pay, total_deductions
      ) VALUES
       ($1, 2025, 3, $2, $3, $4, $5, $6, $7, $8),
       ($1, 2025, 4, $9, $10, $11, $12, $13, $14, $15)`,
      [
        "demo-user",
        50000,
        20000,
        12000,
        6000,
        70000,
        52000,
        18000,
        52000,
        20800,
        12800,
        6240,
        72800,
        53760,
        19040,
      ],
    );
    console.log("Seeded demo-user salary rows.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
