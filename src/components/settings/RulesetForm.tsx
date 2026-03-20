"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { fetchJson } from "@/lib/client";
import { zodResolver } from "@hookform/resolvers/zod";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const formSchema = z.object({
  name: z.string().min(2),
  c2c_partner_name: z.string().min(2),
  length: z.string().min(3),
  include_sections: z.object({
    accusations_audit: z.boolean(),
    tactical_empathy: z.boolean(),
    labelling: z.boolean(),
    mirroring: z.boolean(),
    calibrated_questions: z.boolean(),
    no_oriented_closing: z.boolean(),
  }),
});

type FormValues = z.infer<typeof formSchema>;

type IncludeSections = FormValues["include_sections"];

type RuleSetRulesJson = Record<string, unknown> & {
  c2c_partner_name?: string;
  length?: string;
  include_sections?: Partial<IncludeSections>;
};

type RuleSet = {
  id: string;
  name: string;
  rulesJson: RuleSetRulesJson;
};

const DEFAULT_INCLUDE_SECTIONS = {
  accusations_audit: true,
  tactical_empathy: true,
  labelling: true,
  mirroring: true,
  calibrated_questions: true,
  no_oriented_closing: true,
};

const DEFAULT_RULESET_PAYLOAD = {
  name: "Default",
  c2c_partner_name: "C2C Partner Ltd",
  length: "250-400 words",
  include_sections: DEFAULT_INCLUDE_SECTIONS,
};

export default function RulesetForm() {
  const [ruleset, setRuleset] = React.useState<RuleSet | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: DEFAULT_RULESET_PAYLOAD.name,
      c2c_partner_name: DEFAULT_RULESET_PAYLOAD.c2c_partner_name,
      length: DEFAULT_RULESET_PAYLOAD.length,
      include_sections: DEFAULT_RULESET_PAYLOAD.include_sections,
    },
  });

  const ensureDefaultRuleset = React.useCallback(async (): Promise<RuleSet> => {
    const created = await fetchJson<RuleSet>("/api/rulesets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: DEFAULT_RULESET_PAYLOAD.name,
        rulesJson: {
          c2c_partner_name: DEFAULT_RULESET_PAYLOAD.c2c_partner_name,
          length: DEFAULT_RULESET_PAYLOAD.length,
          include_sections: DEFAULT_RULESET_PAYLOAD.include_sections,
        },
        isDefault: true,
      }),
    });

    return created;
  }, []);

  const loadRules = React.useCallback(async () => {
    try {
      setErrorMessage(null);
      const data = await fetchJson<RuleSet[]>("/api/rulesets");
      let active = data.find((item) => item.name === "Default") ?? data[0];

      if (!active) {
        active = await ensureDefaultRuleset();
      }

      setRuleset(active);
      form.reset({
        name: active.name,
        c2c_partner_name:
          active.rulesJson?.c2c_partner_name ??
          DEFAULT_RULESET_PAYLOAD.c2c_partner_name,
        length: active.rulesJson?.length ?? DEFAULT_RULESET_PAYLOAD.length,
        include_sections: {
          accusations_audit:
            active.rulesJson?.include_sections?.accusations_audit ??
            DEFAULT_INCLUDE_SECTIONS.accusations_audit,
          tactical_empathy:
            active.rulesJson?.include_sections?.tactical_empathy ??
            DEFAULT_INCLUDE_SECTIONS.tactical_empathy,
          labelling:
            active.rulesJson?.include_sections?.labelling ??
            DEFAULT_INCLUDE_SECTIONS.labelling,
          mirroring:
            active.rulesJson?.include_sections?.mirroring ??
            DEFAULT_INCLUDE_SECTIONS.mirroring,
          calibrated_questions:
            active.rulesJson?.include_sections?.calibrated_questions ??
            DEFAULT_INCLUDE_SECTIONS.calibrated_questions,
          no_oriented_closing:
            active.rulesJson?.include_sections?.no_oriented_closing ??
            DEFAULT_INCLUDE_SECTIONS.no_oriented_closing,
        },
      });
    } catch (error) {
      setErrorMessage((error as Error).message || "Unable to load rules.");
    }
  }, [ensureDefaultRuleset, form]);

  React.useEffect(() => {
    loadRules();
  }, [loadRules]);

  const onSubmit = async (values: FormValues) => {
    setSaving(true);
    try {
      setErrorMessage(null);

      const activeRuleset = ruleset ?? (await ensureDefaultRuleset());
      setRuleset(activeRuleset);

      await fetchJson(`/api/rulesets/${activeRuleset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          rulesJson: {
            ...(activeRuleset.rulesJson ?? {}),
            c2c_partner_name: values.c2c_partner_name,
            length: values.length,
            include_sections: values.include_sections,
          },
          isDefault: true,
        }),
      });
      await loadRules();
    } catch (error) {
      setErrorMessage((error as Error).message || "Unable to save rules.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ruleset</CardTitle>
        <p className="text-sm text-slate-600">
          Adjust the positioning rules, British English requirements, and Voss
          toggles.
        </p>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          {errorMessage ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </p>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label
                className="text-sm font-medium text-slate-700"
                htmlFor="name"
              >
                Ruleset name
              </label>
              <Input id="name" {...form.register("name")} />
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium text-slate-700"
                htmlFor="c2c_partner_name"
              >
                C2C partner name
              </label>
              <Input
                id="c2c_partner_name"
                {...form.register("c2c_partner_name")}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label
              className="text-sm font-medium text-slate-700"
              htmlFor="length"
            >
              Preferred length
            </label>
            <Input id="length" {...form.register("length")} />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">
              Voss techniques
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {(
                Object.keys(form.watch("include_sections")) as Array<
                  keyof FormValues["include_sections"]
                >
              ).map((key) => (
                <label
                  key={key}
                  className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm"
                >
                  <span className="text-slate-600">
                    {key.replace(/_/g, " ")}
                  </span>
                  <Switch
                    checked={form.watch("include_sections")[key]}
                    onCheckedChange={(checked: boolean) =>
                      form.setValue(`include_sections.${key}`, checked)
                    }
                  />
                </label>
              ))}
            </div>
          </div>

          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save rules"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
