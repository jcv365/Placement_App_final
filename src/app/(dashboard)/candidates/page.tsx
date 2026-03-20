import CandidatesClient from "@/components/candidates/CandidatesClient";

export default function CandidatesPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Candidates</h1>
      <CandidatesClient />
    </div>
  );
}
