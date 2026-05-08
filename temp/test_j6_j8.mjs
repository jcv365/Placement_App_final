/**
 * Test J6 (inferCandidateProfileFromCv) and J8 (formatCvForAts)
 * with a real PDF file upload via candidate-signup.
 */
const BASE = "http://localhost:3001";
const COOKIE = "tenantId=dotcloudconsulting";
const fs = await import("fs");

async function main() {
  console.log("\n── J6+J8: candidate-signup with PDF ──\n");

  const pdfBuffer = fs.readFileSync("temp/test_cv.pdf");
  const fd = new FormData();
  fd.append("fullName", "Thabo Mokoena");
  fd.append("email", "test-ai-profile@example.com");
  fd.append("phone", "+27123456789");
  fd.append(
    "file",
    new Blob([pdfBuffer], { type: "application/pdf" }),
    "cv.pdf",
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
    console.log(`Body: ${JSON.stringify(body).slice(0, 300)}`);
    console.log(
      `${ok ? "✅" : "❌"} J6+J8: inferCandidateProfileFromCv + formatCvForAts — ${ok ? "PASS" : "FAIL"}`,
    );
  } catch (e) {
    console.log(`❌ J6+J8: ${e.message.slice(0, 150)}`);
  }
}

main();
