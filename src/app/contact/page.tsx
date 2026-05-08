"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Input } from "@/components/ui/input";
import { SuccessBanner } from "@/components/ui/success-banner";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/client";
import Link from "next/link";
import * as React from "react";

type FormState = "idle" | "submitting" | "success" | "error";

export default function ContactPage() {
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [formState, setFormState] = React.useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormState("submitting");
    setErrorMessage(null);

    try {
      await fetchJson("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email, company, phone, message }),
      });
      setFormState("success");
      setFullName("");
      setEmail("");
      setCompany("");
      setPhone("");
      setMessage("");
    } catch (err) {
      setFormState("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to send message",
      );
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold text-slate-900">
            Contract Placements
          </Link>
          <Link
            href="/demo"
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            ← Back to Demo
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-xl px-6 py-10">
        <h1 className="text-3xl font-bold text-slate-900">Get in Touch</h1>
        <p className="mt-3 text-base leading-relaxed text-slate-600">
          Interested in Contract Placements? Fill in the form below and our team
          will be in touch shortly.
        </p>

        {formState === "success" && (
          <div className="mt-6">
            <SuccessBanner message="Thank you for your enquiry! We'll be in touch soon." />
          </div>
        )}

        {formState === "error" && errorMessage && (
          <div className="mt-6">
            <ErrorBanner message={errorMessage} />
          </div>
        )}

        {formState !== "success" && (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle className="text-lg">Contact Us</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <label
                    htmlFor="fullName"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <Input
                    id="fullName"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="John Smith"
                  />
                </div>

                <div>
                  <label
                    htmlFor="email"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Email Address <span className="text-red-500">*</span>
                  </label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="john@example.com"
                  />
                </div>

                <div>
                  <label
                    htmlFor="company"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Company Name
                  </label>
                  <Input
                    id="company"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Acme Ltd"
                  />
                </div>

                <div>
                  <label
                    htmlFor="phone"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Phone Number
                  </label>
                  <Input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+27 82 123 4567"
                  />
                </div>

                <div>
                  <label
                    htmlFor="message"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Message <span className="text-red-500">*</span>
                  </label>
                  <Textarea
                    id="message"
                    required
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Tell us about your requirements…"
                    rows={5}
                  />
                </div>

                <Button
                  type="submit"
                  disabled={formState === "submitting"}
                  className="mt-2"
                >
                  {formState === "submitting" ? "Sending…" : "Send Enquiry"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
