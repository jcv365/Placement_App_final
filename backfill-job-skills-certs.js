const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const SKILL_CATALOG = [
  "Azure","AWS","GCP","Kubernetes","Docker","Terraform","Ansible","Python","Java","C#",".NET","Node.js","React","Next.js","Angular","Vue","SQL","NoSQL","MongoDB","PostgreSQL","MySQL","Redshift","PySpark","Spark","Hadoop","Kafka","Linux","Windows","Active Directory","DevOps","SRE","Networking","Network Security","Cybersecurity","CI/CD","Git","GitHub Actions","Jenkins","Power BI","D365","Dynamics 365","Microsoft Dynamics","AI","Machine Learning","MLOps","Data Engineering","ETL","API Design","REST","GraphQL","TypeScript","JavaScript","Bash","PowerShell","Azure DevOps","Databricks","Snowflake","ElasticSearch","Redis","Microservices"
];

const CERT_PATTERNS = [
  /\bAZ-\d{3}\b/g,
  /\bDP-\d{3}\b/g,
  /\bAI-\d{3}\b/g,
  /\bSC-\d{3}\b/g,
  /\bPL-\d{3}\b/g,
  /\bMS-\d{3}\b/g,
  /\bAWS Certified[^,.;\n]*/gi,
  /\bMicrosoft Certified[^,.;\n]*/gi,
  /\bCISSP\b/gi,
  /\bCCNA\b/gi,
  /\bCCNP\b/gi,
  /\bCEH\b/gi,
  /\bPMP\b/gi,
  /\bITIL\b/gi,
  /\bCISA\b/gi,
  /\bCISM\b/gi,
  /\bCompTIA Security\+\b/gi,
  /\bCompTIA Network\+\b/gi,
  /\bCompTIA A\+\b/gi,
  /\bCertified Kubernetes Administrator\b/gi,
  /\bCKA\b/gi,
  /\bScrum Master\b/gi,
  /\bPSM\b/gi,
  /\bCSM\b/gi,
];

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseCsv(value) {
  return clean(value)
    .split(/[\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(items) {
  return [...new Set(items.map((item) => clean(item)).filter(Boolean))];
}

function extractSkills(text) {
  const blob = ` ${clean(text).toLowerCase()} `;
  const found = [];
  for (const skill of SKILL_CATALOG) {
    const needle = ` ${skill.toLowerCase()} `;
    if (blob.includes(needle) || blob.includes(skill.toLowerCase())) {
      found.push(skill);
    }
  }
  return unique(found);
}

function extractCertifications(text) {
  const blob = clean(text);
  const found = [];
  for (const pattern of CERT_PATTERNS) {
    const matches = blob.match(pattern) || [];
    for (const match of matches) {
      found.push(match.toUpperCase() === match ? match : clean(match));
    }
  }
  return unique(found);
}

(async () => {
  const jobs = await prisma.job.findMany({
    select: {
      id: true,
      title: true,
      rawText: true,
      description: true,
      requiredSkillsCsv: true,
      requiredCertificationsCsv: true,
    },
  });

  let updated = 0;
  for (const job of jobs) {
    const source = `${job.title || ""}\n${job.description || ""}\n${job.rawText || ""}`;

    const existingSkills = parseCsv(job.requiredSkillsCsv);
    const existingCerts = parseCsv(job.requiredCertificationsCsv);

    const extractedSkills = extractSkills(source);
    const extractedCerts = extractCertifications(source);

    const mergedSkills = unique([...existingSkills, ...extractedSkills]);
    const mergedCerts = unique([...existingCerts, ...extractedCerts]);

    const nextSkills = mergedSkills.join(", ");
    const nextCerts = mergedCerts.join(", ");

    if (
      nextSkills !== clean(job.requiredSkillsCsv) ||
      nextCerts !== clean(job.requiredCertificationsCsv)
    ) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          requiredSkillsCsv: nextSkills || null,
          requiredCertificationsCsv: nextCerts || null,
        },
      });
      updated += 1;
    }
  }

  console.log("jobsScanned", jobs.length);
  console.log("jobsUpdated", updated);

  await prisma.$disconnect();
})().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
