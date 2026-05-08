import { PrismaClient } from "@prisma/client";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const p = new PrismaClient({
  datasources: { db: { url: "file:" + path.join(ROOT, "prisma/prod.db") } },
});
const cs = await p.candidate.findMany({
  select: {
    fullName: true,
    formattedCvFileName: true,
    formattedCvPdfData: true,
  },
});
cs.forEach((c) =>
  console.log(
    c.fullName.padEnd(40),
    (c.formattedCvFileName ?? "null").padEnd(25),
    c.formattedCvPdfData ? c.formattedCvPdfData.byteLength + "b" : "null",
  ),
);
console.log(
  `\nTotal: ${cs.length}, with PDF: ${cs.filter((c) => c.formattedCvPdfData).length}`,
);
await p.$disconnect();
