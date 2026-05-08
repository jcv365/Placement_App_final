import EmailLogClient from "@/components/emailLog/EmailLogClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Email log",
};

export default function EmailLogPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1>Email log</h1>
        <p className="text-sm text-slate-600">
          Search generated email drafts by date and candidate. View applications
          with no email draft yet.
        </p>
      </div>
      <EmailLogClient />
    </div>
  );
}
