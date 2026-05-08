const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const SKILL_CATALOG = [
  "Azure","AWS","GCP","Kubernetes","Docker","Terraform","Ansible","Python","Java","C#",".NET","Node.js","React","Next.js","Angular","Vue","SQL","NoSQL","MongoDB","PostgreSQL","MySQL","Redshift","PySpark","Spark","Hadoop","Kafka","Linux","Windows","Active Directory","DevOps","SRE","Networking","Network Security","Cybersecurity","CI/CD","Git","GitHub Actions","Jenkins","Power BI","D365","Dynamics 365","Microsoft Dynamics","AI","Machine Learning","MLOps","Data Engineering","ETL","API Design","REST","GraphQL","TypeScript","JavaScript","Bash","PowerShell","Azure DevOps","Databricks","Snowflake","Elasticsearch","Redis","Microservices","HPC","Storage"
];

const TITLE_HINTS = [
  "DevOps","SRE","Azure","AWS","GCP","Linux","Network Security","Networking","Data Engineering","Machine Learning","MLOps","Storage","HPC","Power BI","Dynamics 365","React","Next.js","Node.js","Python","Java","SQL"
];

const CERT_PATTERNS = [
  /\bAZ-\d{3}\b/g,/\bDP-\d{3}\b/g,/\bAI-\d{3}\b/g,/\bSC-\d{3}\b/g,/\bPL-\d{3}\b/g,/\bMS-\d{3}\b/g,
  /\bAWS Certified[^,.;\n]*/gi,/\bMicrosoft Certified[^,.;\n]*/gi,/\bCISSP\b/gi,/\bCCNA\b/gi,/\bCCNP\b/gi,
  /\bCEH\b/gi,/\bPMP\b/gi,/\bITIL\b/gi,/\bCISA\b/gi,/\bCISM\b/gi,/\bCompTIA Security\+\b/gi,
  /\bCompTIA Network\+\b/gi,/\bCompTIA A\+\b/gi,/\bCertified Kubernetes Administrator\b/gi,/\bCKA\b/gi,
  /\bScrum Master\b/gi,/\bPSM\b/gi,/\bCSM\b/gi
];

function clean(v){return String(v||"").replace(/\s+/g," ").trim();}
function parseCsv(v){return clean(v).split(/[\n,;|]+/).map(x=>x.trim()).filter(Boolean);}
function unique(items){return [...new Set(items.map(clean).filter(Boolean))];}

function extractSkills(source,title){
  const blob = ` ${clean(source).toLowerCase()} `;
  const found = [];
  for(const skill of SKILL_CATALOG){
    const n = skill.toLowerCase();
    if(blob.includes(` ${n} `) || blob.includes(n)) found.push(skill);
  }
  const titleBlob = ` ${clean(title).toLowerCase()} `;
  for(const hint of TITLE_HINTS){
    const n = hint.toLowerCase();
    if(titleBlob.includes(` ${n} `) || titleBlob.includes(n)) found.push(hint);
  }
  return unique(found);
}

function extractCertifications(source){
  const blob = clean(source);
  const found = [];
  for(const r of CERT_PATTERNS){
    const matches = blob.match(r) || [];
    for(const m of matches){ found.push(clean(m)); }
  }
  return unique(found);
}

(async()=>{
  const jobs = await prisma.job.findMany({
    select:{ id:true, title:true, rawText:true, requiredSkillsCsv:true, requiredCertificationsCsv:true }
  });

  let updated = 0;
  for(const job of jobs){
    const source = `${job.title||""}\n${job.rawText||""}`;
    const existingSkills = parseCsv(job.requiredSkillsCsv);
    const existingCerts = parseCsv(job.requiredCertificationsCsv);
    const mergedSkills = unique([...existingSkills, ...extractSkills(source, job.title)]);
    const mergedCerts = unique([...existingCerts, ...extractCertifications(source)]);

    const nextSkills = mergedSkills.join(", ");
    const nextCerts = mergedCerts.join(", ");

    if(nextSkills !== clean(job.requiredSkillsCsv) || nextCerts !== clean(job.requiredCertificationsCsv)){
      await prisma.job.update({ where:{id:job.id}, data:{
        requiredSkillsCsv: nextSkills || null,
        requiredCertificationsCsv: nextCerts || null,
      }});
      updated += 1;
    }
  }

  console.log("jobsScanned", jobs.length);
  console.log("jobsUpdated", updated);
  await prisma.$disconnect();
})().catch(async(e)=>{ console.error(e); await prisma.$disconnect(); process.exit(1);});
