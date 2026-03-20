"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { fetchJson } from "@/lib/client";
import Link from "next/link";
import * as React from "react";

type Job = {
  id: string;
  title: string;
  rawText: string;
  opportunityUrl?: string | null;
  opportunityEmail?: string | null;
  createdAt: string;
  company?: { name: string } | null;
};

function getSource(job: Job): "LinkedIn" | "Upload" {
  const sourceBlob =
    `${job.opportunityUrl ?? ""} ${job.opportunityEmail ?? ""} ${job.rawText}`.toLowerCase();
  return sourceBlob.includes("linkedin") ? "LinkedIn" : "Upload";
}

function estimateConfidence(job: Job): number {
  const text = job.rawText.toLowerCase();
  let score = 55;
  if (text.includes("must") || text.includes("required")) score += 10;
  if (text.includes("azure") || text.includes("aws") || text.includes("cloud"))
    score += 8;
  if (
    text.includes("contract") ||
    text.includes("inside ir35") ||
    text.includes("outside ir35")
  )
    score += 7;
  if (job.company?.name) score += 5;
  if (job.opportunityUrl || job.opportunityEmail) score += 5;
  return Math.min(95, Math.max(45, score));
}

function getSourceUrl(job: Job): string | null {
  if (job.opportunityUrl?.trim()) {
    return job.opportunityUrl.trim();
  }

  const match = job.rawText.match(/https?:\/\/[^\s)\]]+/i);
  return match?.[0] ?? null;
}

function getSourceType(job: Job): "job" | "post" | "group" {
  const sourceUrl = getSourceUrl(job)?.toLowerCase() ?? "";
  if (sourceUrl.includes("/jobs/") || sourceUrl.includes("/jobs/view/")) {
    return "job";
  }
  if (sourceUrl.includes("/groups/")) {
    return "group";
  }
  return "post";
}

export default function LinkedinFeedClient() {
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [previewJob, setPreviewJob] = React.useState<Job | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<Job[]>("/api/jobs");
      const ingested = data
        .map((job) => ({ ...job, source: getSource(job) }))
        .filter(
          (job) =>
            job.source === "LinkedIn" ||
            Boolean(job.opportunityUrl || job.opportunityEmail),
        );
      setJobs(ingested);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <p className="text-sm text-slate-500">Loading LinkedIn feed...</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">LinkedIn feed</h1>
        <p className="text-sm text-slate-600">
          Recent ingested opportunities with source, confidence, and timestamp.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ingested opportunities</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <div className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-600">
              No ingested opportunities yet. Run your LinkedIn ingest process or
              upload opportunities from Jobs.
            </div>
          ) : (
            <ul className="space-y-3 text-sm text-slate-700">
              {jobs.map((job) => {
                const source = getSource(job);
                const confidence = estimateConfidence(job);
                const sourceUrl = getSourceUrl(job);
                const sourceType = getSourceType(job);
                return (
                  <li
                    key={job.id}
                    className="rounded border border-slate-200 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-medium text-slate-900">{job.title}</p>
                      <div className="flex items-center gap-2">
                        <Badge>{source}</Badge>
                        <Badge>{sourceType}</Badge>
                        <Badge>{confidence}%</Badge>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500">
                      Company: {job.company?.name?.trim() || "Unknown"} •
                      Ingested:{" "}
                      {new Date(job.createdAt).toLocaleString("en-GB")}
                    </p>
                    <p className="text-xs text-slate-500">
                      Source URL: {sourceUrl ?? "Not available"}
                    </p>
                    <p className="mt-2 line-clamp-3 text-sm text-slate-600">
                      {job.rawText.length > 260
                        ? `${job.rawText.slice(0, 260)}...`
                        : job.rawText}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                        onClick={() => setPreviewJob(job)}
                      >
                        View full post
                      </Button>
                      {sourceUrl ? (
                        <Button
                          asChild
                          className="h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                        >
                          <Link
                            href={sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View original post
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!previewJob}
        onOpenChange={(open: boolean) => !open && setPreviewJob(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Opportunity preview</DialogTitle>
          </DialogHeader>
          {previewJob ? (
            <div className="space-y-3 text-sm text-slate-700">
              <p className="font-medium text-slate-900">{previewJob.title}</p>
              <p>Company: {previewJob.company?.name?.trim() || "Unknown"}</p>
              <p>Source: {getSource(previewJob)}</p>
              <p>Source type: {getSourceType(previewJob)}</p>
              <p>Confidence: {estimateConfidence(previewJob)}%</p>
              <p>
                Ingested:{" "}
                {new Date(previewJob.createdAt).toLocaleString("en-GB")}
              </p>
              <p>Source URL: {getSourceUrl(previewJob) ?? "Not available"}</p>
              <p className="whitespace-pre-wrap rounded-md border border-slate-200 p-3">
                {previewJob.rawText}
              </p>
              {getSourceUrl(previewJob) ? (
                <Button
                  asChild
                  className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                >
                  <Link
                    href={getSourceUrl(previewJob) as string}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open source
                  </Link>
                </Button>
              ) : null}
              <Button
                type="button"
                className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                onClick={() => setPreviewJob(null)}
              >
                Close
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
