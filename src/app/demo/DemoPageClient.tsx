"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { fetchJson } from "@/lib/client";
import { demoJourneys, demoPersonas, type DemoJourney } from "@/lib/demoTours";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

type LoginState = "idle" | "loading" | "error";

export default function DemoPageClient() {
  const router = useRouter();
  const [loginState, setLoginState] = React.useState<LoginState>("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  async function handleStartJourney(journey: DemoJourney) {
    setLoginState("loading");
    setErrorMessage(null);

    const persona =
      demoPersonas.find((p) => p.id === journey.persona) ?? demoPersonas[0];

    try {
      await fetchJson("/api/demo/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId: persona.id }),
      });

      // Store selected journey in sessionStorage for the dashboard to pick up
      sessionStorage.setItem("demoTourJourneyId", journey.id);
      router.push(journey.steps[0].route);
    } catch (err) {
      setLoginState("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to start demo",
      );
    }
  }

  return (
    <div className="min-h-screen select-none bg-gradient-to-b from-slate-50 to-white">
      {/* Hero */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold text-slate-900">
            Contract Placements
          </Link>
          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
            Read-Only Demo
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* Introduction */}
        <div className="mb-10 max-w-2xl">
          <h1 className="text-3xl font-bold text-slate-900">
            Guided Platform Demo
          </h1>
          <p className="mt-3 text-base leading-relaxed text-slate-600">
            Choose a guided journey below to walk through a specific workflow
            step-by-step. Each tour shows you the feature in context with real
            data — no sign-up required.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            This is a read-only showcase. Interested?{" "}
            <Link
              href="/contact"
              className="font-medium text-blue-600 hover:underline"
            >
              Get in touch
            </Link>{" "}
            to learn more.
          </p>
        </div>

        {errorMessage && (
          <div className="mb-6">
            <ErrorBanner message={errorMessage} />
          </div>
        )}

        {/* Guided Journeys Grid */}
        <section>
          <h2 className="mb-4 text-lg font-semibold text-slate-900">
            Guided Journeys
          </h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {demoJourneys.map((journey) => {
              const persona = demoPersonas.find(
                (p) => p.id === journey.persona,
              );
              return (
                <Card
                  key={journey.id}
                  className="flex flex-col justify-between"
                >
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{journey.icon}</span>
                      <CardTitle className="text-base">
                        {journey.title}
                      </CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <p className="text-sm leading-relaxed text-slate-600">
                      {journey.description}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-400">
                        {journey.steps.length}{" "}
                        {journey.steps.length === 1 ? "step" : "steps"} ·{" "}
                        {persona?.label ?? journey.persona}
                      </span>
                      <Button
                        size="sm"
                        onClick={() => handleStartJourney(journey)}
                        disabled={loginState === "loading"}
                      >
                        Start Tour
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Call to action */}
        <section className="mt-12 rounded-lg border border-blue-200 bg-blue-50 p-6 text-center">
          <h2 className="text-lg font-semibold text-slate-900">
            Interested in Contract Placements?
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Get in touch with our team to discuss how we can help your business.
          </p>
          <Button asChild className="mt-4" size="lg">
            <Link href="/contact">Contact Us →</Link>
          </Button>
        </section>
      </div>
    </div>
  );
}
