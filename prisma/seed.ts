import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.salary.deleteMany({ where: { userId: "demo-user" } });

  await prisma.salary.createMany({
    data: [
      {
        userId: "demo-user",
        month: "2025-03",
        basic: 50000,
        hra: 20000,
        tax: 12000,
        pf: 6000,
      },
      {
        userId: "demo-user",
        month: "2025-04",
        basic: 52000,
        hra: 20800,
        tax: 12800,
        pf: 6240,
      },
    ],
  });

  console.log("Seeded demo-user salary rows.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
