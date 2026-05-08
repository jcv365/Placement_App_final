const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  try {
    await p.$executeRawUnsafe(
      `ALTER TABLE Job ADD COLUMN requiresNonSaLocation BOOLEAN`,
    );
    console.log("Column added");
  } catch (e) {
    if (
      e.message.includes("duplicate") ||
      e.message.includes("already exists")
    ) {
      console.log("Column already exists");
    } else {
      console.log("Error:", e.message);
    }
  }
  await p.$disconnect();
}
main();
