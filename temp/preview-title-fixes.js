const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const ROLE_WORDS = [
  "engineer","developer","architect","consultant","manager","analyst","designer","recruiter","specialist","lead","sre","devops","scientist","administrator","product","platform"
];
const BAD_PATTERNS = [/feed post/i,/founder\s*@/i,/lunchtime leads/i,/^north america$/i,/^egypt$/i,/^india$/i,/^delhi$/i,/^mumbai$/i,/^pune$/i,/^bangalore$/i,/^hyderabad$/i,/^web3$/i,/^blockchain$/i,/^data science$/i,/^python$/i,/^java$/i,/^crypto$/i,/^engineering$/i,/^aiml$/i,/^cloud$/i,/^security$/i,/^big data$/i,/^genai$/i,/^chatgpt$/i,/^public speaker$/i,/^stem ambassador$/i,/\|\s*follow/i];

function clean(s){return (s||"").replace(/\s+/g," ").trim();}
function hasRoleWord(s){const t=s.toLowerCase(); return ROLE_WORDS.some((w)=>t.includes(w));}
function isBad(s){const t=clean(s); if(!t||t.length>100||t.length<3) return true; return BAD_PATTERNS.some((r)=>r.test(t));}
function score(s){const t=clean(s); let v=0; if(!isBad(t)) v+=3; if(hasRoleWord(t)) v+=4; if(t.length>=12 && t.length<=70) v+=2; if(/[|•]/.test(t)) v-=2; if(/^#/.test(t)) v-=1; return v;}

(async()=>{
  const start=new Date("2026-04-07T00:00:00.000Z");
  const end=new Date("2026-04-08T00:00:00.000Z");
  const tenantId="dotcloudconsulting";
  const jobs=await p.job.findMany({where:{tenantId,createdAt:{gte:start,lt:end}},select:{id:true,title:true,rawText:true,createdAt:true},orderBy:{createdAt:"asc"}});

  const groups=new Map();
  for(const j of jobs){
    const key=clean(j.rawText).toLowerCase();
    const list=groups.get(key)||[];
    list.push(j);
    groups.set(key,list);
  }

  const updates=[];

  for(const list of groups.values()){
    if(list.length<2) continue;
    const best=list.slice().sort((a,b)=>score(b.title)-score(a.title))[0];
    const bestTitle=clean(best.title);
    if(!bestTitle || isBad(bestTitle)) continue;
    for(const j of list){
      if(clean(j.title)!==bestTitle && (isBad(j.title) || !hasRoleWord(j.title))){
        updates.push({id:j.id,from:j.title,to:bestTitle,reason:"group_normalised"});
      }
    }
  }

  const singles=jobs.filter((j)=>!groups.get(clean(j.rawText).toLowerCase()) || groups.get(clean(j.rawText).toLowerCase()).length===1);
  for(const j of singles){
    const raw=clean(j.rawText);
    if(!isBad(j.title)) continue;
    const m=raw.match(/(?:job title|hiring|urgent hiring|contract opportunity)\s*[:\-–]\s*([^|•\n]{8,90})/i);
    if(m && m[1]){
      const next=clean(m[1]);
      if(next && hasRoleWord(next) && next!==clean(j.title)){
        updates.push({id:j.id,from:j.title,to:next,reason:"pattern_extract"});
      }
    }
  }

  console.log("totalToday",jobs.length);
  console.log("proposedUpdates",updates.length);
  for(const u of updates.slice(0,40)) console.log(JSON.stringify(u));
  await p.$disconnect();
})().catch(async(e)=>{console.error(e); await p.$disconnect(); process.exit(1);});
