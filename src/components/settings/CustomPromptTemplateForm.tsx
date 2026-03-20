"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/client";
import * as React from "react";

type RuleSet = {
  id: string;
  name: string;
  isDefault: boolean;
  rulesJson: Record<string, unknown>;
};

const DEFAULT_RULESET_NAME = "Default";

type FormState = {
  rulesetId: string | null;
  rulesetName: string;
  rulesJson: Record<string, unknown>;
  customPrompt: string;
};

const INITIAL_STATE: FormState = {
  rulesetId: null,
  rulesetName: DEFAULT_RULESET_NAME,
  rulesJson: {},
  customPrompt: "",
};

export default function CustomPromptTemplateForm() {
  const [state, setState] = React.useState<FormState>(INITIAL_STATE);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );

  const loadRuleset = React.useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const rulesets = await fetchJson<RuleSet[]>("/api/rulesets");

      const active =
        rulesets.find((item) => item.isDefault) ??
        rulesets.find((item) => item.name === DEFAULT_RULESET_NAME) ??
        rulesets[0];

      if (!active) {
        setState(INITIAL_STATE);
        return;
      }

      const customPrompt =
        typeof active.rulesJson?.custom_email_prompt === "string"
          ? active.rulesJson.custom_email_prompt
          : "";

      setState({
        rulesetId: active.id,
        rulesetName: active.name || DEFAULT_RULESET_NAME,
        rulesJson: active.rulesJson ?? {},
        customPrompt,
      });
    } catch (error) {
      setErrorMessage(
        (error as Error).message || "Unable to load template settings.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadRuleset();
  }, [loadRuleset]);

  const onSave = async () => {
    try {
      setSaving(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      const trimmedPrompt = state.customPrompt.trim();
      const nextRulesJson: Record<string, unknown> = {
        ...state.rulesJson,
      };

      if (trimmedPrompt) {
        nextRulesJson.custom_email_prompt = trimmedPrompt;
      } else {
        delete nextRulesJson.custom_email_prompt;
      }

      if (state.rulesetId) {
        await fetchJson(`/api/rulesets/${state.rulesetId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rulesJson: nextRulesJson,
            isDefault: true,
          }),
        });
      } else {
        await fetchJson<RuleSet>("/api/rulesets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: state.rulesetName || DEFAULT_RULESET_NAME,
            rulesJson: nextRulesJson,
            isDefault: true,
          }),
        });
      }

      setSuccessMessage("Template prompt saved.");
      await loadRuleset();
    } catch (error) {
      setErrorMessage(
        (error as Error).message || "Unable to save template prompt.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Template Prompt</CardTitle>
        <p className="text-sm text-slate-600">
          Add optional instructions to shape AI-generated client submission
          emails for this signed-in tenant.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {errorMessage ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        ) : null}

        {successMessage ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {successMessage}
          </p>
        ) : null}

        <Textarea
          value={state.customPrompt}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
            setState((current) => ({
              ...current,
              customPrompt: event.target.value,
            }))
          }
          rows={10}
          placeholder="Optional: add strict instructions for tone, structure, or evidence handling."
          disabled={loading}
        />

        <p className="text-xs text-slate-500">
          This prompt is appended as a mandatory override during email
          generation. Leave blank to use default behaviour only.
        </p>

        <Button onClick={onSave} disabled={loading || saving}>
          {saving ? "Saving..." : "Save template prompt"}
        </Button>
      </CardContent>
    </Card>
  );
}
