import { requireAdminContextFromRequest } from "@/lib/adminAuth";
import { jsonError, jsonOk } from "@/lib/apiResponses";
import { DEFAULT_OUTLOOK_MAILBOX } from "@/lib/constants";
import {
  createOutlookDraftForMailbox,
  getGraphAppAccessToken,
} from "@/lib/graph";
import {
  buildRedactedCvPdfFromText,
  redactContactDetailsInPdf,
} from "@/lib/pdfRedaction";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RepairResult = {
  dbPairs: number;
  alreadyInMailbox: number;
  repaired: number;
  failed: number;
  skippedNoEmail: number;
};

function parseEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@") && s.includes("."));
}

async function fetchAllSubjectsFromFolder(
  token: string,
  mailbox: string,
  folderName: string,
): Promise<Set<string>> {
  const subjects = new Set<string>();
  let url: string | null =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/${folderName}/messages` +
    `?$select=subject&$top=999`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Graph error fetching ${folderName}: ${res.status} ${text}`,
      );
    }
    const data = (await res.json()) as {
      value?: Array<{ subject?: string }>;
      "@odata.nextLink"?: string;
    };
    for (const msg of data.value ?? []) {
      if (msg.subject) subjects.add(msg.subject.trim());
    }
    url = data["@odata.nextLink"] ?? null;
  }
  return subjects;
}

export async function POST(request: Request) {
  let tenantId: string;
  try {
    ({ tenantId } = requireAdminContextFromRequest(request));
  } catch {
    return jsonError("Authentication required", 401);
  }

  try {
    const mailbox =
      process.env.OUTLOOK_SHARED_MAILBOX?.trim() ||
      process.env.GRAPH_SENDER_USER?.trim() ||
      DEFAULT_OUTLOOK_MAILBOX;

    // Fetch all DB email drafts for this tenant (all time), latest draft per pair
    // NOTE: We exclude large binary fields (cvFileData, formattedCvPdfData) from
    // the initial query to avoid Prisma/SQLite "Failed to convert rust String" errors.
    // Binary data is fetched per-candidate only when needed for attachment generation.
    const dbDrafts = await prisma.emailDraft.findMany({
      where: { tenantId },
      select: {
        id: true,
        subject: true,
        htmlBody: true,
        application: {
          select: {
            jobId: true,
            candidateId: true,
            job: { select: { title: true, opportunityEmail: true } },
            candidate: {
              select: {
                fullName: true,
                email: true,
                phone: true,
                rawCV: true,
                cvFileName: true,
                cvMimeType: true,
                // cvFileData and formattedCvPdfData fetched separately below
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Deduplicate per job+candidate — keep the latest (first in desc order)
    const pairMap = new Map<string, (typeof dbDrafts)[number]>();
    for (const d of dbDrafts) {
      const key = `${d.application.jobId}::${d.application.candidateId}`;
      if (!pairMap.has(key)) pairMap.set(key, d);
    }
    const dbPairs = [...pairMap.values()];

    // Fetch subjects from both Drafts + Sent Items
    const token = await getGraphAppAccessToken();
    const [draftSubjects, sentSubjects] = await Promise.all([
      fetchAllSubjectsFromFolder(token, mailbox, "drafts"),
      fetchAllSubjectsFromFolder(token, mailbox, "sentitems"),
    ]);
    const allOutlookSubjects = new Set([...draftSubjects, ...sentSubjects]);

    // Determine which pairs are missing
    const missing = dbPairs.filter(
      (d) => !allOutlookSubjects.has(d.subject?.trim() ?? ""),
    );
    const actionable = missing.filter(
      (d) => parseEmails(d.application.job.opportunityEmail).length > 0,
    );
    const skippedNoEmail = missing.length - actionable.length;

    let repaired = 0;
    let failed = 0;

    for (const d of actionable) {
      const toEmails = parseEmails(d.application.job.opportunityEmail);

      // Build CV attachment — mirrors the logic in the generate route
      const candidate = d.application.candidate;

      // Fetch binary CV data separately to avoid Prisma/SQLite bulk-read errors
      const candidateBinary = await prisma.candidate.findUnique({
        where: { id: d.application.candidateId },
        select: {
          cvFileData: true,
          formattedCvPdfData: true,
          formattedCvFileName: true,
        },
      });

      const hasFormattedPdf =
        Boolean(candidateBinary?.formattedCvPdfData) &&
        (candidateBinary?.formattedCvPdfData?.byteLength ?? 0) > 0;

      let redactedPdfBase64: string | undefined;

      if (hasFormattedPdf && candidateBinary?.formattedCvPdfData) {
        redactedPdfBase64 = Buffer.from(
          candidateBinary.formattedCvPdfData,
        ).toString("base64");
      } else {
        const hasBinaryCv =
          Boolean(candidateBinary?.cvFileData) &&
          (candidateBinary?.cvFileData?.byteLength ?? 0) > 0;
        const looksLikePdfCv =
          hasBinaryCv &&
          ((candidate.cvMimeType?.trim().toLowerCase() || "") ===
            "application/pdf" ||
            (candidate.cvFileName?.trim().toLowerCase().endsWith(".pdf") ??
              false));

        if (looksLikePdfCv && candidateBinary?.cvFileData) {
          try {
            const redactedPdf = await redactContactDetailsInPdf({
              pdfBytes: Buffer.from(candidateBinary.cvFileData),
              email: candidate.email,
              phone: candidate.phone,
            });
            redactedPdfBase64 = redactedPdf.toString("base64");
          } catch (error) {
            console.warn("[REPAIR_DRAFT_REDACTION_FALLBACK]", {
              reason: (error as Error)?.message ?? "unknown",
            });
            redactedPdfBase64 = undefined;
          }
        }

        if (!redactedPdfBase64 && (candidate.rawCV ?? "").trim()) {
          const fallbackRedactedPdf = await buildRedactedCvPdfFromText({
            cvText: candidate.rawCV ?? "",
            candidateName: candidate.fullName,
            email: candidate.email,
            phone: candidate.phone,
          });
          redactedPdfBase64 = fallbackRedactedPdf.toString("base64");
        }
      }

      const safeName =
        (candidate.fullName ?? "candidate")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "candidate";

      const attachments = redactedPdfBase64
        ? [
            {
              filename:
                (hasFormattedPdf
                  ? candidateBinary?.formattedCvFileName?.trim()
                  : candidate.cvFileName?.trim()) || `${safeName}-cv.pdf`,
              contentBase64: redactedPdfBase64,
              contentType: "application/pdf",
            },
          ]
        : [];

      const draftParams = {
        mailbox,
        subject: d.subject ?? "",
        htmlBody: d.htmlBody ?? "",
        to: toEmails,
        attachments,
      };

      try {
        await createOutlookDraftForMailbox(draftParams);
        repaired++;
      } catch (error) {
        const errorMsg = (error as Error)?.message ?? String(error);
        // Retry once on Graph API rate limit (429)
        if (errorMsg.includes("429") || errorMsg.includes("Throttled")) {
          console.warn("[REPAIR_DRAFT_RETRY]", { subject: d.subject });
          await new Promise((r) => setTimeout(r, 5000));
          try {
            await createOutlookDraftForMailbox(draftParams);
            repaired++;
          } catch (retryError) {
            console.error("[REPAIR_DRAFT_FAILED_AFTER_RETRY]", {
              subject: d.subject,
              error: (retryError as Error)?.message ?? String(retryError),
            });
            failed++;
          }
        } else {
          console.error("[REPAIR_DRAFT_FAILED]", {
            subject: d.subject,
            error: errorMsg,
          });
          failed++;
        }
      }
      // Delay to respect Graph API rate limits (1s for large payloads)
      await new Promise((r) => setTimeout(r, 1000));
    }

    const result: RepairResult = {
      dbPairs: dbPairs.length,
      alreadyInMailbox: dbPairs.length - missing.length,
      repaired,
      failed,
      skippedNoEmail,
    };

    return jsonOk(result);
  } catch (error) {
    return jsonError((error as Error).message ?? "Repair failed", 500);
  }
}
