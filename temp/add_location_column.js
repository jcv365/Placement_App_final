const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  try {
    await p.$executeRawUnsafe(
      "ALTER TABLE Job ADD COLUMN requiresNonSaLocation BOOLEAN",
    );
    console.log("Column added successfully");
  } catch (e) {
    if (e.message.includes("duplicate column name")) {
      console.log("Column already exists");
    } else {
      console.error("Error:", e.message);
    }
  }
  await p.$disconnect();
})();
