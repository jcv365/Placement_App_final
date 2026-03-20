"use client";

import AiProviderSettings from "@/components/settings/AiProviderSettings";
import CustomPromptTemplateForm from "@/components/settings/CustomPromptTemplateForm";
import GithubDeviceLogin from "@/components/settings/GithubDeviceLogin";
import RulesetForm from "@/components/settings/RulesetForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";
import * as React from "react";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = React.useState("ai-provider");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>Settings</h1>
        <Button asChild>
          <Link href="/admin/signin">Open admin portal</Link>
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="ai-provider">AI provider</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="admin">Admin portal</TabsTrigger>
        </TabsList>

        <TabsContent value="ai-provider">
          <AiProviderSettings
            onOpenIntegrations={() => setActiveTab("integrations")}
          />
        </TabsContent>

        <TabsContent value="rules">
          <RulesetForm />
        </TabsContent>

        <TabsContent value="templates">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Templates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-700">
                <p>
                  Email and message templates are generated from rules and
                  context.
                </p>
                <p>
                  Use the Rules tab to control tone, structure, and output
                  behaviour.
                </p>
              </CardContent>
            </Card>
            <CustomPromptTemplateForm />
          </div>
        </TabsContent>

        <TabsContent value="integrations">
          <div className="space-y-4">
            <GithubDeviceLogin />
            <Card>
              <CardHeader>
                <CardTitle>Admin portal</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-700">
                <p>
                  Open the admin portal to manage company branding, finance
                  settings, and monthly reports.
                </p>
                <Button asChild>
                  <Link href="/admin/signin">Open admin portal</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="admin">
          <Card>
            <CardHeader>
              <CardTitle>Admin portal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-700">
              <p>
                Use the admin portal for company branding, finance settings,
                month-to-date charge preview, and report history downloads.
              </p>
              <Button asChild>
                <Link href="/admin/signin">Go to admin sign-in</Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
