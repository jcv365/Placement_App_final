"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import * as React from "react";

type EnvVar = {
  key: string;
  set: boolean;
  hint: string;
  optional?: boolean;
};

type EnvGroup = {
  label: string;
  vars: EnvVar[];
};

export default function PlatformConfigSettings() {
  const [groups, setGroups] = React.useState<EnvGroup[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/settings/env-status", {
        credentials: "include",
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? `HTTP ${res.status}`);
        return;
      }

      const payload = (await res.json()) as {
        data?: { groups?: EnvGroup[] };
      };
      setGroups(payload.data?.groups ?? []);
    } catch {
      setError("Failed to load configuration status.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-slate-500">
          Loading configuration status…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Platform configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const totalRequired = groups.flatMap((g) =>
    g.vars.filter((v) => !v.optional),
  );
  const missingRequired = totalRequired.filter((v) => !v.set);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Platform configuration</CardTitle>
          <p className="text-sm text-slate-600">
            Environment variables that power the platform. Values are never
            shown — only whether each variable is set.
          </p>
        </CardHeader>
        <CardContent>
          {missingRequired.length === 0 ? (
            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
              All required variables configured
            </Badge>
          ) : (
            <Badge className="border-amber-200 bg-amber-50 text-amber-700">
              {missingRequired.length} required variable
              {missingRequired.length > 1 ? "s" : ""} missing
            </Badge>
          )}
        </CardContent>
      </Card>

      {groups.map((group) => (
        <Card key={group.label}>
          <CardHeader>
            <CardTitle className="text-base">{group.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-100">
              {group.vars.map((v) => (
                <li
                  key={v.key}
                  className="flex flex-wrap items-start gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <span
                    className="group relative inline-flex cursor-help items-center gap-1.5 font-mono text-sm text-slate-800"
                    title={v.hint}
                  >
                    {v.key}
                    <span className="pointer-events-none absolute bottom-full left-0 z-10 mb-2 hidden w-72 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-sans text-slate-600 shadow-lg group-hover:block">
                      {v.hint}
                    </span>
                  </span>

                  {v.optional && (
                    <span className="text-xs text-slate-400">optional</span>
                  )}

                  <span className="ml-auto">
                    {v.set ? (
                      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        Set
                      </Badge>
                    ) : v.optional ? (
                      <Badge className="border-slate-200 bg-slate-50 text-slate-500">
                        Not set
                      </Badge>
                    ) : (
                      <Badge className="border-red-200 bg-red-50 text-red-700">
                        Missing
                      </Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
