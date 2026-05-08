"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SuccessBanner } from "@/components/ui/success-banner";
import * as React from "react";

const ACCEPTED_FILE_TYPES = ".pdf,application/pdf";

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

type PreviewData = {
  fullName: string;
  email: string | null;
  phone: string | null;
  skills: string[];
  certifications: string[];
  suggestedRoles: string[];
  cvFileName: string | null;
  _rawCV: string;
  _cvFileName: string | null;
  _cvMimeType: string | null;
  _cvFileBase64: string | null;
};

export default function CandidateSignupPage() {
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<PreviewData | null>(null);

  // Editable preview fields
  const [previewName, setPreviewName] = React.useState("");
  const [previewEmail, setPreviewEmail] = React.useState("");
  const [previewPhone, setPreviewPhone] = React.useState("");

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    if (selected && selected.size > MAX_FILE_SIZE_BYTES) {
      setError(`File size must be under ${MAX_FILE_SIZE_MB} MB.`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setError(null);
    setFile(selected);
  };

  /** Step 1 — upload CV and get a preview of extracted data. */
  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!file) {
      setError("Please select your CV file to upload.");
      return;
    }

    setSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (fullName.trim()) formData.append("fullName", fullName.trim());
      if (email.trim()) formData.append("email", email.trim());
      if (phone.trim()) formData.append("phone", phone.trim());

      const response = await fetch("/api/public/candidate-signup", {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(120_000),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 403 && !data) {
          setError(
            "Your upload was blocked by our security filter. " +
              "This can happen if your filename contains brackets or special characters. " +
              "Please rename the file and try again.",
          );
        } else {
          setError(
            data?.error?.message ?? "Something went wrong. Please try again.",
          );
        }
        return;
      }

      const previewData = data.data as PreviewData;
      setPreview(previewData);
      setPreviewName(previewData.fullName);
      setPreviewEmail(previewData.email ?? "");
      setPreviewPhone(previewData.phone ?? "");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      if (/timeout|aborted/i.test(message)) {
        setError(
          "The upload is taking longer than expected. Please try again with a smaller file.",
        );
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  /** Step 2 — confirm the reviewed profile and save. */
  const handleConfirm = async () => {
    if (!preview) return;

    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch("/api/public/candidate-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: previewName.trim(),
          email: previewEmail.trim() || null,
          phone: previewPhone.trim() || null,
          skills: preview.skills,
          certifications: preview.certifications,
          suggestedRoles: preview.suggestedRoles,
          _rawCV: preview._rawCV,
          _cvFileName: preview._cvFileName,
          _cvMimeType: preview._cvMimeType,
          _cvFileBase64: preview._cvFileBase64,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 403 && !data) {
          setError(
            "Your upload was blocked by our security filter. " +
              "This can happen if your filename contains brackets or special characters. " +
              "Please rename the file and try again.",
          );
        } else {
          setError(
            data?.error?.message ?? "Something went wrong. Please try again.",
          );
        }
        return;
      }

      setSuccess(
        "Thank you for registering! Your CV has been received and our team will be in touch.",
      );
      setPreview(null);
      setFullName("");
      setEmail("");
      setPhone("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartOver = () => {
    setPreview(null);
    setError(null);
    setSuccess(null);
  };

  const canUpload = Boolean(file) && !submitting;
  const canConfirm = Boolean(previewName.trim()) && !submitting;

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6 py-12">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-slate-900">
          Candidate Registration
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Upload your CV and we&rsquo;ll add you to our system. Our team will
          review your profile and match you with suitable contract
          opportunities.
        </p>
      </div>

      {/* ── Step 1: Upload form ─────────────────────────────────────── */}
      {!preview && !success ? (
        <Card>
          <CardHeader>
            <CardTitle>Your details</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpload} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Full name</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Jane Smith"
                />
                <p className="text-xs text-slate-500">
                  Optional — we can extract this from your CV.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. jane@example.com"
                />
                <p className="text-xs text-slate-500">
                  Optional — we can extract this from your CV.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone number</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. +44 7700 900000"
                />
                <p className="text-xs text-slate-500">
                  Optional — we can extract this from your CV.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cv">
                  CV / Resume <span className="text-red-500">*</span>
                </Label>
                <Input
                  ref={fileInputRef}
                  id="cv"
                  type="file"
                  accept={ACCEPTED_FILE_TYPES}
                  onChange={handleFileChange}
                  className="cursor-pointer"
                />
                <p className="text-xs text-slate-500">
                  PDF only. Maximum {MAX_FILE_SIZE_MB} MB.
                </p>
              </div>

              {error ? <ErrorBanner message={error} /> : null}

              <Button type="submit" disabled={!canUpload} className="w-full">
                {submitting ? "Uploading and analysing…" : "Upload CV"}
              </Button>

              {submitting ? (
                <p className="text-center text-sm text-slate-500">
                  We&rsquo;re analysing your CV — this may take a moment.
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Step 2: Preview & confirm ───────────────────────────────── */}
      {preview && !success ? (
        <Card>
          <CardHeader>
            <CardTitle>Review your profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              We&rsquo;ve extracted the following from your CV. Please review
              and correct anything before confirming.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="previewName">
                Full name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="previewName"
                value={previewName}
                onChange={(e) => setPreviewName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="previewEmail">Email address</Label>
              <Input
                id="previewEmail"
                type="email"
                value={previewEmail}
                onChange={(e) => setPreviewEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="previewPhone">Phone number</Label>
              <Input
                id="previewPhone"
                type="tel"
                value={previewPhone}
                onChange={(e) => setPreviewPhone(e.target.value)}
              />
            </div>

            {preview.skills.length > 0 ? (
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-700">Skills</p>
                <div className="flex flex-wrap gap-1.5">
                  {preview.skills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-700"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {preview.certifications.length > 0 ? (
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-700">
                  Certifications
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {preview.certifications.map((cert) => (
                    <span
                      key={cert}
                      className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs text-emerald-700"
                    >
                      {cert}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {preview.suggestedRoles.length > 0 ? (
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-700">
                  Suggested roles
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {preview.suggestedRoles.map((role) => (
                    <span
                      key={role}
                      className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs text-amber-700"
                    >
                      {role}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {preview.cvFileName ? (
              <p className="text-xs text-slate-500">
                File: {preview.cvFileName}
              </p>
            ) : null}

            {error ? <ErrorBanner message={error} /> : null}

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={handleStartOver}
                disabled={submitting}
                className="flex-1"
              >
                Start over
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={!canConfirm}
                className="flex-1"
              >
                {submitting ? "Saving…" : "Confirm and submit"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Success ─────────────────────────────────────────────────── */}
      {success ? (
        <Card>
          <CardContent className="py-8">
            <SuccessBanner message={success} />
            <div className="mt-4 text-center">
              <Button variant="outline" onClick={handleStartOver}>
                Register another candidate
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <p className="text-center text-xs text-slate-400">
        Powered by Contract Placements
      </p>
    </div>
  );
}
