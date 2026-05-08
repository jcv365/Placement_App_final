import AtsWindowClient from "@/components/candidates/AtsWindowClient";
import { APP_SESSION_COOKIE, getAppSessionFromToken } from "@/lib/appAuth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function AtsWindowPage({
  searchParams,
}: {
  searchParams: Promise<{ candidateId?: string; autoPreview?: string }>;
}) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(APP_SESSION_COOKIE)?.value;
  const session = getAppSessionFromToken(sessionToken);

  if (!session) {
    redirect("/auth/signin");
  }

  const params = await searchParams;
  const candidateId = params.candidateId?.trim() || null;
  const initialAutoPreview = params.autoPreview === "1";

  return (
    <AtsWindowClient
      initialCandidateId={candidateId}
      initialAutoPreview={initialAutoPreview}
    />
  );
}
