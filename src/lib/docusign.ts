import crypto from "crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

type SendAgreementParams = {
  agreementType: "NDA" | "TEAMING_AGREEMENT";
  candidateName: string;
  candidateEmail: string;
  candidateId: string;
};

type SendAgreementResult = {
  envelopeId: string;
  provider: "docusign";
};

type AgreementTemplateConfig = {
  templateId: string;
  roleName: string;
};

type AgreementDocumentConfig = {
  documentId: string;
  name: string;
  fileExtension: string;
  documentBase64: string;
};

type AgreementPayloadConfig =
  | { mode: "template"; template: AgreementTemplateConfig }
  | { mode: "document"; document: AgreementDocumentConfig };

function getTrimmedEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function getAgreementLabel(
  agreementType: SendAgreementParams["agreementType"],
) {
  return agreementType === "NDA" ? "NDA" : "teaming agreement";
}

function getAgreementKey(agreementType: SendAgreementParams["agreementType"]) {
  return agreementType === "NDA" ? "NDA" : "TEAMING";
}

function getRoleNameForAgreement(
  agreementType: SendAgreementParams["agreementType"],
): string {
  const key = getAgreementKey(agreementType);
  return (
    getTrimmedEnv(`DOCUSIGN_${key}_ROLE_NAME`) ||
    getTrimmedEnv("DOCUSIGN_TEMPLATE_ROLE_NAME") ||
    "Signer"
  );
}

function getTemplateIdForAgreement(
  agreementType: SendAgreementParams["agreementType"],
): string | undefined {
  const key = getAgreementKey(agreementType);
  return getTrimmedEnv(`DOCUSIGN_${key}_TEMPLATE_ID`);
}

function getDocumentPathForAgreement(
  agreementType: SendAgreementParams["agreementType"],
): string | undefined {
  const key = getAgreementKey(agreementType);
  return getTrimmedEnv(`DOCUSIGN_${key}_DOCUMENT_PATH`);
}

function getDocumentBase64ForAgreement(
  agreementType: SendAgreementParams["agreementType"],
): string | undefined {
  const key = getAgreementKey(agreementType);
  return getTrimmedEnv(`DOCUSIGN_${key}_DOCUMENT_BASE64`);
}

function getDefaultDocumentPath(
  agreementType: SendAgreementParams["agreementType"],
): string {
  const fileName =
    agreementType === "NDA" ? "nda.pdf" : "teaming-agreement.pdf";
  return path.join(process.cwd(), "data", "agreements", fileName);
}

function inferFileExtension(fileName: string): string {
  const extension = path.extname(fileName).replace(/^\./, "").toLowerCase();
  return extension || "pdf";
}

async function buildAgreementPayloadConfig(
  agreementType: SendAgreementParams["agreementType"],
): Promise<AgreementPayloadConfig> {
  const templateId = getTemplateIdForAgreement(agreementType);
  if (templateId) {
    return {
      mode: "template",
      template: {
        templateId,
        roleName: getRoleNameForAgreement(agreementType),
      },
    };
  }

  const documentBase64 = getDocumentBase64ForAgreement(agreementType);
  if (documentBase64) {
    return {
      mode: "document",
      document: {
        documentId: "1",
        name: `${getAgreementLabel(agreementType)}.pdf`,
        fileExtension: "pdf",
        documentBase64,
      },
    };
  }

  const configuredPath =
    getDocumentPathForAgreement(agreementType) ||
    getDefaultDocumentPath(agreementType);

  try {
    const bytes = await fs.readFile(configuredPath);
    return {
      mode: "document",
      document: {
        documentId: "1",
        name: path.basename(configuredPath),
        fileExtension: inferFileExtension(configuredPath),
        documentBase64: bytes.toString("base64"),
      },
    };
  } catch {
    throw new Error(
      `DocuSign ${getAgreementLabel(agreementType)} document is not configured. Set DOCUSIGN_${getAgreementKey(agreementType)}_TEMPLATE_ID or DOCUSIGN_${getAgreementKey(agreementType)}_DOCUMENT_PATH (or place ${getDefaultDocumentPath(agreementType)}).`,
    );
  }
}

function getDocuSignBaseUrl(): string | null {
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  const baseUri = process.env.DOCUSIGN_BASE_URI;

  if (!accountId || !baseUri) {
    return null;
  }

  return `${baseUri.replace(/\/$/, "")}/restapi/v2.1/accounts/${accountId}`;
}

export async function sendAgreementForSignature(
  params: SendAgreementParams,
): Promise<SendAgreementResult> {
  const baseUrl = getDocuSignBaseUrl();
  const accessToken = getTrimmedEnv("DOCUSIGN_ACCESS_TOKEN");

  if (!baseUrl || !accessToken) {
    throw new Error(
      "DocuSign is not configured. Set DOCUSIGN_BASE_URI, DOCUSIGN_ACCOUNT_ID, and DOCUSIGN_ACCESS_TOKEN.",
    );
  }

  const payloadConfig = await buildAgreementPayloadConfig(params.agreementType);
  const agreementLabel = getAgreementLabel(params.agreementType);
  const sourceHash = crypto
    .createHash("sha1")
    .update(`${params.candidateId}:${params.agreementType}:${Date.now()}`)
    .digest("hex")
    .slice(0, 12);

  const envelopeBody: Record<string, unknown> = {
    emailSubject: `${agreementLabel} for signature`,
    status: "sent",
    emailBlurb: `Please review and sign your ${agreementLabel}.`,
    customFields: {
      textCustomFields: [
        {
          name: "candidateId",
          value: params.candidateId,
          required: "false",
          show: "true",
        },
        {
          name: "agreementType",
          value: params.agreementType,
          required: "false",
          show: "true",
        },
        {
          name: "requestTrace",
          value: sourceHash,
          required: "false",
          show: "false",
        },
      ],
    },
  };

  if (payloadConfig.mode === "template") {
    envelopeBody.templateId = payloadConfig.template.templateId;
    envelopeBody.templateRoles = [
      {
        email: params.candidateEmail,
        name: params.candidateName,
        roleName: payloadConfig.template.roleName,
      },
    ];
  } else {
    envelopeBody.documents = [payloadConfig.document];
    envelopeBody.recipients = {
      signers: [
        {
          email: params.candidateEmail,
          name: params.candidateName,
          recipientId: "1",
          routingOrder: "1",
        },
      ],
    };
  }

  const response = await fetch(`${baseUrl}/envelopes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(envelopeBody),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `DocuSign send failed (${response.status}): ${details || "Unknown error"}`,
    );
  }

  const payload = (await response.json()) as { envelopeId?: string };

  if (!payload.envelopeId) {
    throw new Error("DocuSign response missing envelopeId");
  }

  return {
    envelopeId: payload.envelopeId,
    provider: "docusign",
  };
}
