import "dotenv/config";
import pg from "pg";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url?.trim()) {
    throw new Error("DATABASE_URL is required");
  }
  const pool = new pg.Pool({ connectionString: url });
  try {
    await pool.query(`DELETE FROM "Salary" WHERE "userId" = $1`, ["demo-user"]);
    await pool.query(
      `INSERT INTO "Salary" ("userId", month, basic, hra, tax, pf) VALUES
       ($1, $2, $3, $4, $5, $6),
       ($1, $7, $8, $9, $10, $11)`,
      [
        "demo-user",
        "2025-03",
        50000,
        20000,
        12000,
        6000,
        "2025-04",
        52000,
        20800,
        12800,
        6240,
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
