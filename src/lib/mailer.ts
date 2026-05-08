import { isGraphMailConfigured, sendGraphMail } from "@/lib/graph";

type SendMailParams = {
  to: string[];
  subject: string;
  text: string;
  attachments?: Array<{
    filename: string;
    content?: string;
    contentBase64?: string;
    contentType?: string;
  }>;
};

export async function sendMail(
  params: SendMailParams,
): Promise<{ sent: boolean; message?: string }> {
  if (!isGraphMailConfigured()) {
    return {
      sent: false,
      message: "Microsoft Graph mail is not configured",
    };
  }

  try {
    await sendGraphMail(params);
    return { sent: true };
  } catch (error) {
    console.error("[mailer] sendMail failed:", (error as Error).message);
    return {
      sent: false,
      message: (error as Error).message,
    };
  }
}
