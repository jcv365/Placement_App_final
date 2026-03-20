import { seedFunctionalTestData } from "../src/lib/seedFunctionalTestData";

async function main() {
  const summary = await seedFunctionalTestData();
  console.log("Functional test data seeded:", summary);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
