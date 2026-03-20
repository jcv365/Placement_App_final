import MatchReviewClient from "@/components/matchReview/MatchReviewClient";

export default async function MatchReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ jobId?: string }>;
}) {
  const params = await searchParams;

  return <MatchReviewClient initialJobId={params.jobId} />;
}
