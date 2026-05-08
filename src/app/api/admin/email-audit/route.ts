import { requireAdminContextFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { checkEmailFactuality } from "@/lib/emailFactualityGuard";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// Allow up to 5 minutes for large audit sweeps.
export const maxDuration = 300;

function truncate(text: string, maxChars = 8000): string {
  return text.length > maxChars
    ? `${text.slice(0, maxChars)}\n[truncated]`
    : text;
}

type FlaggedItem = {
  applicationId: string;
  candidateName: string;
  roleTitle: string;
  score: number;
  hallucinatedClaims: string[];
};

export async function POST(request: Request) {
  try {
    const { tenantId } = requireAdminContextFromRequest(request);

    const url = new URL(request.url);
    const deleteFlagged = url.searchParams.get("deleteFlagged") === "true";

    const applications = await prisma.application.findMany({
      where: { tenantId, currentStage: "EMAIL_DRAFTED" },
      select: {
        id: true,
        candidate: {
          select: { fullName: true, rawCV: true },
        },
        job: {
          select: { title: true, rawText: true },
        },
        emails: {
          select: { id: true, htmlBody: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    let pass = 0;
    let fail = 0;
    let errors = 0;
    let deletedDrafts = 0;
    const flaggedItems: FlaggedItem[] = [];

    for (const app of applications) {
      const draft = app.emails[0];
      if (!draft) {
        errors++;
        continue;
      }

      try {
        const report = await checkEmailFactuality({
          emailHtml: draft.htmlBody,
          jdText: truncate(app.job.rawText ?? ""),
          cvText: truncate(app.candidate.rawCV ?? ""),
          roleTitle: app.job.title,
          candidateName: app.candidate.fullName,
          companyName: "",
        });

        if (report.pass) {
          pass++;
        } else {
          fail++;
          flaggedItems.push({
            applicationId: app.id,
            candidateName: app.candidate.fullName,
            roleTitle: app.job.title,
            score: report.score,
            hallucinatedClaims: report.hallucinatedClaims,
          });

          if (deleteFlagged) {
            await prisma.$transaction([
              prisma.emailDraft.deleteMany({
                where: { tenantId, applicationId: app.id },
              }),
              prisma.application.update({
                where: { id: app.id },
                data: { currentStage: "SHORTLISTED" },
              }),
            ]);
            deletedDrafts++;
          }
        }
      } catch {
        errors++;
      }
    }

    return jsonOk({
      total: applications.length,
      pass,
      fail,
      errors,
      deletedDrafts,
      flaggedItems,
    });
  } catch (error) {
    return jsonError((error as Error).message || "Email audit failed", 500);
  }
}
