"use strict";
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.candidate
  .findMany({
    where: { isActive: true },
    select: { id: true, fullName: true, email: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  })
  .then((cs) => {
    console.log("Total:" + cs.length);
    cs.forEach((c) =>
      console.log(
        JSON.stringify({
          name: c.fullName,
          email: c.email,
          created: c.createdAt,
        }),
      ),
    );
    return p.$disconnect();
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
