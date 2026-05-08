"use client";

import GraphAuthButton from "@/components/auth/GraphAuthButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SuccessBanner } from "@/components/ui/success-banner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchJson } from "@/lib/client";
import { useRouter } from "next/navigation";
import * as React from "react";

type MessageType = "success" | "error";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [registerDisplayName, setRegisterDisplayName] = React.useState("");
  const [registerDomain, setRegisterDomain] = React.useState("");
  const [registerAdminName, setRegisterAdminName] = React.useState("");
  const [registerAdminEmail, setRegisterAdminEmail] = React.useState("");
  const [registerPassword, setRegisterPassword] = React.useState("");
  const [registerBrandName, setRegisterBrandName] = React.useState("");
  const [registerBillingContactEmail, setRegisterBillingContactEmail] =
    React.useState("");
  const [registerBillingModel, setRegisterBillingModel] = React.useState<
    "PERCENTAGE" | "PER_HOUR_PER_CANDIDATE"
  >("PERCENTAGE");
  const [registerBillingRatePerHour, setRegisterBillingRatePerHour] =
    React.useState("");
  const [registerOutlookMailbox, setRegisterOutlookMailbox] =
    React.useState("");
  const [activeTab, setActiveTab] = React.useState<"signin" | "signup">(
    "signin",
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [messageType, setMessageType] = React.useState<MessageType>("success");

  React.useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const verified = searchParams.get("verified");
    if (!verified) {
      return;
    }

    if (verified === "success") {
      setActiveTab("signin");
      setMessageType("success");
      setMessage("Email confirmed. Your account is now active.");
      return;
    }

    if (verified === "missing") {
      setMessageType("error");
      setMessage("Verification link is incomplete.");
      return;
    }

    if (verified === "invalid") {
      setMessageType("error");
      setMessage("Verification link is invalid or has expired.");
    }
  }, []);

  const handleTenantSignIn = async () => {
    setSubmitting(true);
    setMessage(null);
    setMessageType("error");

    try {
      await fetchJson("/api/auth/tenant/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      router.push("/overview");
      router.refresh();
    } catch (error) {
      const rawMessage = (error as Error).message || "Unable to sign in";
      if (/invalid sign-in credentials/i.test(rawMessage)) {
        setMessage("Email or password is incorrect.");
      } else {
        setMessage(rawMessage);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleTenantSignUp = async () => {
    setSubmitting(true);
    setMessage(null);
    setMessageType("success");

    try {
      const response = await fetchJson<{ tenantId: string }>(
        "/api/auth/tenant/register-company",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: registerDisplayName,
            domain: registerDomain || undefined,
            adminName: registerAdminName,
            adminEmail: registerAdminEmail,
            password: registerPassword,
            brandName: registerBrandName,
            billingContactEmail: registerBillingContactEmail,
            billingModel: registerBillingModel,
            billingRatePerHour:
              registerBillingModel === "PER_HOUR_PER_CANDIDATE"
                ? Number(registerBillingRatePerHour)
                : undefined,
            outlookMailbox: registerOutlookMailbox || undefined,
          }),
        },
      );

      setEmail(registerAdminEmail);
      setPassword("");
      setRegisterPassword("");
      setActiveTab("signin");
      setMessage(
        `Company account created. Your tenant ID is ${response.tenantId}. A verification email has been sent to ${registerAdminEmail}. You must verify this email before signing in.`,
      );
    } catch (error) {
      setMessageType("error");
      setMessage((error as Error).message || "Unable to sign up");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold text-slate-900">Sign in</h1>

      <Card>
        <CardHeader>
          <CardTitle>Tenant account access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Tabs
            value={activeTab}
            onValueChange={(value) =>
              setActiveTab(value as "signin" | "signup")
            }
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="space-y-3">
              <Input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email"
              />
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
              />
              <Button
                disabled={submitting || !email || !password}
                onClick={handleTenantSignIn}
              >
                {submitting ? "Signing in..." : "Sign in to tenant"}
              </Button>
            </TabsContent>

            <TabsContent value="signup" className="space-y-3">
              <Input
                value={registerDisplayName}
                onChange={(event) => setRegisterDisplayName(event.target.value)}
                placeholder="Company name"
              />
              <Input
                value={registerDomain}
                onChange={(event) => setRegisterDomain(event.target.value)}
                placeholder="Company domain (optional)"
              />
              <Input
                value={registerAdminName}
                onChange={(event) => setRegisterAdminName(event.target.value)}
                placeholder="First admin name"
              />
              <Input
                value={registerAdminEmail}
                onChange={(event) => setRegisterAdminEmail(event.target.value)}
                placeholder="First admin email"
              />
              <Input
                value={registerBrandName}
                onChange={(event) => setRegisterBrandName(event.target.value)}
                placeholder="Billing brand name"
              />
              <Input
                value={registerBillingContactEmail}
                onChange={(event) =>
                  setRegisterBillingContactEmail(event.target.value)
                }
                placeholder="Billing contact email"
              />
              <Select
                value={registerBillingModel}
                onValueChange={(value) =>
                  setRegisterBillingModel(
                    value as "PERCENTAGE" | "PER_HOUR_PER_CANDIDATE",
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Billing model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENTAGE">Percentage</SelectItem>
                  <SelectItem value="PER_HOUR_PER_CANDIDATE">
                    Per hour per candidate
                  </SelectItem>
                </SelectContent>
              </Select>
              {registerBillingModel === "PER_HOUR_PER_CANDIDATE" ? (
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={registerBillingRatePerHour}
                  onChange={(event) =>
                    setRegisterBillingRatePerHour(event.target.value)
                  }
                  placeholder="Billing rate per hour"
                />
              ) : null}
              <Input
                value={registerOutlookMailbox}
                onChange={(event) =>
                  setRegisterOutlookMailbox(event.target.value)
                }
                placeholder="Outlook mailbox for drafting"
              />
              <Input
                type="password"
                value={registerPassword}
                onChange={(event) => setRegisterPassword(event.target.value)}
                placeholder="Password (minimum 8 characters)"
              />
              <Button
                disabled={
                  submitting ||
                  !registerDisplayName ||
                  !registerAdminName ||
                  !registerAdminEmail ||
                  !registerPassword ||
                  !registerBrandName ||
                  !registerBillingContactEmail ||
                  !registerOutlookMailbox ||
                  (registerBillingModel === "PER_HOUR_PER_CANDIDATE" &&
                    !registerBillingRatePerHour)
                }
                onClick={handleTenantSignUp}
                variant="outline"
              >
                {submitting ? "Creating account..." : "Create account"}
              </Button>
              <p className="text-sm text-slate-600">
                You can add more tenant users later from Settings.
              </p>
            </TabsContent>
          </Tabs>

          {message ? (
            messageType === "error" ? (
              <ErrorBanner message={message} />
            ) : (
              <SuccessBanner message={message} />
            )
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Microsoft Graph sign-in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-700">
          <p>Sign in with Microsoft to enable Outlook draft creation.</p>
          <GraphAuthButton />
        </CardContent>
      </Card>

      <p className="text-center text-sm text-slate-500">
        Are you a candidate?{" "}
        <a
          href="/candidate-signup"
          className="font-medium text-blue-600 hover:underline"
        >
          Register and upload your CV here
        </a>
      </p>

      <p className="text-center text-sm text-slate-500">
        Want to explore first?{" "}
        <a href="/demo" className="font-medium text-blue-600 hover:underline">
          Try the interactive demo
        </a>
      </p>
    </div>
  );
}
