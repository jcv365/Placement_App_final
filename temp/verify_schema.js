process.chdir("/app");
const { PrismaClient } = require("/app/node_modules/.prisma/client");
const p = new PrismaClient();
p.$queryRawUnsafe("PRAGMA table_info(Candidate)")
  .then((cols) => {
    const relevant = cols.filter((c) =>
      ["cvStorageMode", "rawCV", "cvFileName", "cvFileData", "id"].includes(
        c.name,
      ),
    );
    console.log(
      "Relevant columns:",
      relevant.map((c) => `${c.name} (${c.type})`).join(", "),
    );
    return p.$disconnect();
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
