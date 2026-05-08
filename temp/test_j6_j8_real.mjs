/**
 * Test J6 (inferCandidateProfileFromCv) and J8 (formatCvForAts)
 * with a REAL CV PDF from the cv/ directory.
 */
const BASE = "http://localhost:3001";
const COOKIE = "tenantId=dotcloudconsulting";
const fs = await import("fs");

async function main() {
  console.log("\n── J6+J8: candidate-signup with real CV PDF ──\n");

  // Try with a real CV PDF first
  let pdfPath = "cv/girly-nomvula-lebelo/girly-nomvula-lebelo.pdf";
  if (!fs.existsSync(pdfPath)) {
    pdfPath = "cv/andre-lombaard/andre-lombaard.pdf";
  }
  if (!fs.existsSync(pdfPath)) {
    console.log("❌ No CV PDF found");
    return;
  }

  const pdfBuffer = fs.readFileSync(pdfPath);
  console.log(`PDF size: ${pdfBuffer.length} bytes`);

  const fd = new FormData();
  fd.append(
    "file",
    new Blob([pdfBuffer], { type: "application/pdf" }),
    "andre-lombaard.pdf",
  );

  try {
    const res = await fetch(`${BASE}/api/public/candidate-signup`, {
      method: "POST",
      headers: { Cookie: COOKIE },
      body: fd,
    });
    const body = await res.json();
    const ok = res.status === 200 || res.status === 201;
    console.log(`Status: ${res.status}`);
    if (ok && body?.data) {
      console.log(`Profile extracted:`);
      console.log(`  Name: ${body.data.fullName || "not extracted"}`);
      console.log(`  Email: ${body.data.email || "not extracted"}`);
      console.log(`  Phone: ${body.data.phone || "not extracted"}`);
      console.log(
        `  Skills: ${JSON.stringify(body.data.skills?.slice(0, 5)) || "none"}`,
      );
      console.log(
        `  Certifications: ${JSON.stringify(body.data.certifications?.slice(0, 3)) || "none"}`,
      );
      console.log(
        `  Suggested Roles: ${JSON.stringify(body.data.suggestedRoles?.slice(0, 3)) || "none"}`,
      );
      console.log(
        `  Formatted CV: ${body.data.formattedCvText ? body.data.formattedCvText.length + " chars" : "none"}`,
      );
    } else {
      console.log(`Body: ${JSON.stringify(body).slice(0, 300)}`);
    }
    console.log(
      `${ok ? "✅" : "❌"} J6+J8: inferCandidateProfileFromCv + formatCvForAts — ${ok ? "PASS" : "FAIL"}`,
    );
  } catch (e) {
    console.log(`❌ J6+J8: ${e.message.slice(0, 150)}`);
  }
}

main();
