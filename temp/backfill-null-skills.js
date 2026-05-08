const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const STOPWORDS = new Set([
  "contract","remote","outside","inside","ir35","the","and","for","with","from","role","post","feed","job","jobs","only","uk","eu","europe","us","usa","india","based","join","looking"
]);

const CERT_PATTERNS = [
  /\bAZ-\d{3}\b/g,/\bDP-\d{3}\b/g,/\bAI-\d{3}\b/g,/\bSC-\d{3}\b/g,/\bPL-\d{3}\b/g,/\bMS-\d{3}\b/g,
  /\bAWS Certified[^,.;\n]*/gi,/\bMicrosoft Certified[^,.;\n]*/gi,/\bCISSP\b/gi,/\bCCNA\b/gi,/\bCCNP\b/gi,
  /\bCEH\b/gi,/\bPMP\b/gi,/\bITIL\b/gi,/\bCISA\b/gi,/\bCISM\b/gi,/\bCKA\b/gi,/\bScrum Master\b/gi
];

function clean(v){return String(v||"").replace(/\s+/g," ").trim();}
function unique(items){return [...new Set(items.map(clean).filter(Boolean))];}

function extractTitleSkills(title){
  const tokens = clean(title)
    .replace(/[^a-zA-Z0-9+#.\-\s]/g, " ")
    .split(/\s+/)
    .map((t)=>t.trim())
    .filter((t)=>t.length >= 3)
    .filter((t)=>!STOPWORDS.has(t.toLowerCase()));

  const phrases = [];
  if (/software engineer/i.test(title)) phrases.push("Software Engineering");
  if (/data engineer/i.test(title)) phrases.push("Data Engineering");
  if (/devops/i.test(title)) phrases.push("DevOps");
  if (/network security/i.test(title)) phrases.push("Network Security");
  if (/azure/i.test(title)) phrases.push("Azure");
  if (/aws/i.test(title)) phrases.push("AWS");
  if (/linux/i.test(title)) phrases.push("Linux");

  return unique([...phrases, ...tokens.slice(0, 4)]);
}

function extractCerts(text){
  const blob = clean(text);
  const found = [];
  for(const r of CERT_PATTERNS){
    const m = blob.match(r) || [];
    for(const x of m) found.push(x);
  }
  return unique(found);
}

(async()=>{
  const jobs = await prisma.job.findMany({
    where: { requiredSkillsCsv: null },
    select: { id:true, title:true, rawText:true, requiredCertificationsCsv:true },
  });

  let updated = 0;
  for(const job of jobs){
    const skills = extractTitleSkills(job.title);
    const certs = unique([
      ...extractCerts(job.rawText),
      ...String(job.requiredCertificationsCsv || "").split(/[\n,;|]+/).map((x)=>x.trim()).filter(Boolean),
    ]);

    await prisma.job.update({
      where: { id: job.id },
      data: {
        requiredSkillsCsv: skills.length ? skills.join(", ") : "General role requirements",
        requiredCertificationsCsv: certs.length ? certs.join(", ") : null,
      },
    });
    updated += 1;
  }

  console.log("nullSkillsRows", jobs.length);
  console.log("updated", updated);
  await prisma.$disconnect();
})().catch(async(e)=>{ console.error(e); await prisma.$disconnect(); process.exit(1);});
