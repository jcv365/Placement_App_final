const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const NOISY_CURRENT = [
  /^north america$/i,/^egypt$/i,/^india$/i,/^delhi$/i,/^mumbai$/i,/^pune$/i,/^bangalore$/i,/^hyderabad$/i,
  /^web3$/i,/^blockchain$/i,/^data science$/i,/^python$/i,/^java$/i,/^crypto$/i,/^engineering$/i,/^aiml$/i,
  /^cloud$/i,/^security$/i,/^big data$/i,/^genai$/i,/^chatgpt$/i,/^public speaker$/i,/^stem ambassador$/i,
  /^remote is fine$/i,/^\s*📍?remote locations?:/i
];
const CANDIDATE_BLACKLIST = [/founder\b/i,/\bceo\b/i,/lunchtime leads/i,/feed post/i,/visit my services/i,/collaborator/i,/ambassador/i,/public speaker/i];
const ROLE_WORDS = ["engineer","developer","architect","consultant","manager","analyst","designer","recruiter","specialist","lead","sre","devops","scientist","administrator","product","platform"];

function clean(s){return (s||"").replace(/\s+/g," ").trim();}
function hasRoleWord(s){const t=s.toLowerCase(); return ROLE_WORDS.some((w)=>t.includes(w));}
function isNoisyCurrent(title){const t=clean(title); return NOISY_CURRENT.some((r)=>r.test(t));}
function isGoodCandidate(title){const t=clean(title); if(!t||t.length<6||t.length>90) return false; if(CANDIDATE_BLACKLIST.some((r)=>r.test(t))) return false; if(/[|]/.test(t) && t.length>60) return false; return hasRoleWord(t);}

(async()=>{
  const start=new Date("2026-04-07T00:00:00.000Z");
  const end=new Date("2026-04-08T00:00:00.000Z");
  const tenantId="dotcloudconsulting";
  const jobs=await p.job.findMany({where:{tenantId,createdAt:{gte:start,lt:end}},select:{id:true,title:true,rawText:true},orderBy:{createdAt:"asc"}});

  const groups=new Map();
  for(const j of jobs){
    const key=clean(j.rawText).toLowerCase();
    const arr=groups.get(key)||[];
    arr.push(j);
    groups.set(key,arr);
  }

  const updates=[];
  for(const list of groups.values()){
    const candidates=list.map((x)=>clean(x.title)).filter(isGoodCandidate);
    if(candidates.length===0) continue;
    const best=candidates.sort((a,b)=>b.length-a.length)[0];
    for(const j of list){
      if(!isNoisyCurrent(j.title)) continue;
      if(clean(j.title)===best) continue;
      updates.push({id:j.id,from:j.title,to:best});
    }
  }

  for (const u of updates) {
    await p.job.update({ where: { id: u.id }, data: { title: u.to } });
  }

  console.log("updated", updates.length);
  for(const u of updates.slice(0,25)) console.log(JSON.stringify(u));

  await p.$disconnect();
})().catch(async(e)=>{console.error(e); await p.$disconnect(); process.exit(1);});
