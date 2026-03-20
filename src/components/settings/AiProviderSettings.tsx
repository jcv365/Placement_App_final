"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import * as React from "react";

type Provider = "auto" | "github-models" | "azure-openai" | "copilot-studio";

const PROVIDER_OPTIONS: Array<{
  value: Provider;
  label: string;
  helper: string;
}> = [
  {
    value: "auto",
    label: "Auto",
    helper: "Use the best available provider automatically.",
  },
  {
    value: "github-models",
    label: "GitHub Models",
    helper: "Use your GitHub device login token.",
  },
  {
    value: "azure-openai",
    label: "Azure OpenAI",
    helper: "Use Azure OpenAI configuration from the server environment.",
  },
  {
    value: "copilot-studio",
    label: "Copilot Studio",
    helper: "Use Copilot Studio configured flows where available.",
  },
];

export default function AiProviderSettings({
  onOpenIntegrations,
}: {
  onOpenIntegrations?: () => void;
}) {
  const [provider, setProvider] = React.useState<Provider>("auto");
  const [savedMessage, setSavedMessage] = React.useState<string | null>(null);
  const [hasGithubToken, setHasGithubToken] = React.useState(false);
  const [azureConfigured, setAzureConfigured] = React.useState(false);

  const loadStatus = React.useCallback(async () => {
    const localToken = localStorage.getItem("githubAccessToken")?.trim();

    try {
      const response = await fetch("/api/ai/status", {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        setHasGithubToken(Boolean(localToken));
        return;
      }

      const payload = (await response.json()) as {
        data?: {
          githubConnected?: boolean;
          azureConfigured?: boolean;
        };
      };

      const githubConnected = Boolean(payload.data?.githubConnected);

      if (!githubConnected && localToken) {
        await fetch("/api/auth/github/device/sync", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: localToken }),
        });
        setHasGithubToken(true);
      } else {
        setHasGithubToken(githubConnected);
      }

      setAzureConfigured(Boolean(payload.data?.azureConfigured));
    } catch {
      setHasGithubToken(Boolean(localToken));
    }
  }, []);

  React.useEffect(() => {
    const savedProvider =
      (localStorage.getItem("aiProvider") as Provider | null) ?? "auto";
    setProvider(savedProvider);
    setHasGithubToken(Boolean(localStorage.getItem("githubAccessToken")));

    void loadStatus();
  }, [loadStatus]);

  React.useEffect(() => {
    const onFocus = () => {
      void loadStatus();
    };

    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [loadStatus]);

  const saveProvider = () => {
    localStorage.setItem("aiProvider", provider);
    setSavedMessage(`Saved provider: ${provider.replace(/-/g, " ")}.`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI provider</CardTitle>
        <p className="text-sm text-slate-600">
          Choose and connect your preferred provider for generation workflows.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {PROVIDER_OPTIONS.map((option) => {
            const selected = provider === option.value;
            return (
              <label
                key={option.value}
                className={
                  selected
                    ? "flex cursor-pointer items-start justify-between gap-3 rounded-md border border-slate-900 bg-slate-900 px-3 py-2 text-white"
                    : "flex cursor-pointer items-start justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-900 hover:bg-slate-50"
                }
              >
                <div>
                  <p className="text-sm font-medium">{option.label}</p>
                  <p
                    className={
                      selected
                        ? "text-xs text-slate-200"
                        : "text-xs text-slate-600"
                    }
                  >
                    {option.helper}
                  </p>
                </div>
                <input
                  type="radio"
                  name="ai-provider"
                  value={option.value}
                  checked={selected}
                  onChange={() => setProvider(option.value)}
                  className="mt-1"
                />
              </label>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge>{`Current: ${provider.replace(/-/g, " ")}`}</Badge>
          <Badge
            className={
              hasGithubToken
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            }
          >
            GitHub token {hasGithubToken ? "connected" : "not connected"}
          </Badge>
          <Badge
            className={
              azureConfigured
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-slate-50 text-slate-700"
            }
          >
            Azure OpenAI {azureConfigured ? "configured" : "not configured"}
          </Badge>
        </div>

        {provider === "github-models" && !hasGithubToken ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            GitHub Models requires device login before generation can run.
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button onClick={saveProvider}>Save provider</Button>
          {provider === "github-models" ? (
            <Button
              className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
              onClick={() => onOpenIntegrations?.()}
            >
              Open integrations
            </Button>
          ) : null}
        </div>

        {savedMessage ? (
          <p className="text-sm text-slate-700">{savedMessage}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
