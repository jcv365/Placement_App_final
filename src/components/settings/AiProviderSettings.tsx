"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import * as React from "react";

export default function AiProviderSettings() {
  const [configured, setConfigured] = React.useState(false);

  const loadStatus = React.useCallback(async () => {
    try {
      const response = await fetch("/api/ai/status", {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        setConfigured(false);
        return;
      }

      const payload = (await response.json()) as {
        data?: {
          liteLlmConfigured?: boolean;
        };
      };
      setConfigured(Boolean(payload.data?.liteLlmConfigured));
    } catch {
      setConfigured(false);
    }
  }, []);

  React.useEffect(() => {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI gateway</CardTitle>
        <p className="text-sm text-slate-600">
          All AI features route through LiteLLM.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            className={
              configured
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            }
          >
            LiteLLM {configured ? "configured" : "not configured"}
          </Badge>
        </div>
        <p className="text-sm text-slate-700">
          Configure `LITELLM_API_BASE` and `LITELLM_API_KEY` in the server
          environment.
        </p>
      </CardContent>
    </Card>
  );
}
