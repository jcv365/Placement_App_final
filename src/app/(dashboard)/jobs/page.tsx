import JobsClient from "@/components/jobs/JobsClient";

export default function JobsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Jobs</h1>
      <JobsClient />
    </div>
  );
}
