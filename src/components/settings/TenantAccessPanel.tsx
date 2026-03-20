"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchJson } from "@/lib/client";
import * as React from "react";

type TenantAuthStatus = {
  authenticated: boolean;
  tenantId?: string;
  user?: {
    id: string;
    fullName: string;
    email: string;
    role: "ADMIN" | "USER";
  };
};

export default function TenantAccessPanel() {
  const [status, setStatus] = React.useState<TenantAuthStatus>({
    authenticated: false,
  });
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );
  const [busy, setBusy] = React.useState(false);

  const [registerDisplayName, setRegisterDisplayName] = React.useState("");
  const [registerAdminName, setRegisterAdminName] = React.useState("");
  const [registerAdminEmail, setRegisterAdminEmail] = React.useState("");
  const [registerPassword, setRegisterPassword] = React.useState("");

  const [signInTenantId, setSignInTenantId] = React.useState("");
  const [signInEmail, setSignInEmail] = React.useState("");
  const [signInPassword, setSignInPassword] = React.useState("");

  const [newUserName, setNewUserName] = React.useState("");
  const [newUserEmail, setNewUserEmail] = React.useState("");
  const [newUserPassword, setNewUserPassword] = React.useState("");
  const [newUserRole, setNewUserRole] = React.useState<"ADMIN" | "USER">(
    "USER",
  );

  const loadStatus = React.useCallback(async () => {
    const payload = await fetchJson<TenantAuthStatus>(
      "/api/auth/tenant/status",
    );
    setStatus(payload);
  }, []);

  React.useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const resetMessages = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const registerCompany = async () => {
    setBusy(true);
    resetMessages();

    try {
      const response = await fetchJson<{ tenantId: string }>(
        "/api/auth/tenant/register-company",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: registerDisplayName,
            adminName: registerAdminName,
            adminEmail: registerAdminEmail,
            password: registerPassword,
          }),
        },
      );

      await loadStatus();
      setSuccessMessage(
        `Company registered. Tenant ID: ${response.tenantId}. Confirm the admin email before signing in.`,
      );
      setRegisterPassword("");
      setSignInTenantId(response.tenantId);
      setSignInEmail(registerAdminEmail);
    } catch (error) {
      setErrorMessage((error as Error).message || "Unable to register company");
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    setBusy(true);
    resetMessages();

    try {
      await fetchJson("/api/auth/tenant/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: signInTenantId,
          email: signInEmail,
          password: signInPassword,
        }),
      });

      await loadStatus();
      setSuccessMessage("Signed in to tenant account.");
      setSignInPassword("");
    } catch (error) {
      setErrorMessage((error as Error).message || "Unable to sign in");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    resetMessages();

    try {
      await fetchJson("/api/auth/tenant/logout", { method: "POST" });
      await loadStatus();
      setSuccessMessage("Signed out.");
    } catch (error) {
      setErrorMessage((error as Error).message || "Unable to sign out");
    } finally {
      setBusy(false);
    }
  };

  const registerUser = async () => {
    setBusy(true);
    resetMessages();

    try {
      await fetchJson("/api/auth/tenant/register-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: newUserName,
          email: newUserEmail,
          password: newUserPassword,
          role: newUserRole,
        }),
      });

      setSuccessMessage("Tenant user registered.");
      setNewUserName("");
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserRole("USER");
    } catch (error) {
      setErrorMessage((error as Error).message || "Unable to register user");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Tenant access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-700">
          <p>
            Register your company as a tenant, then sign in and create tenant
            users or tenant admins.
          </p>
          <p>
            Current session:{" "}
            {status.authenticated ? "Signed in" : "Not signed in"}
          </p>
          {status.authenticated && status.user ? (
            <p>
              Tenant: <strong>{status.tenantId}</strong> | User:{" "}
              <strong>{status.user.fullName}</strong> ({status.user.role})
            </p>
          ) : null}
        </CardContent>
      </Card>

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

      <Card>
        <CardHeader>
          <CardTitle>Register company</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={registerDisplayName}
            onChange={(event) => setRegisterDisplayName(event.target.value)}
            placeholder="Company name"
          />
          <Input
            value={registerAdminName}
            onChange={(event) => setRegisterAdminName(event.target.value)}
            placeholder="First tenant admin name"
          />
          <Input
            value={registerAdminEmail}
            onChange={(event) => setRegisterAdminEmail(event.target.value)}
            placeholder="First tenant admin email"
          />
          <Input
            type="password"
            value={registerPassword}
            onChange={(event) => setRegisterPassword(event.target.value)}
            placeholder="Password (minimum 8 characters)"
          />
          <Button
            disabled={
              busy ||
              !registerDisplayName ||
              !registerAdminName ||
              !registerAdminEmail ||
              !registerPassword
            }
            onClick={registerCompany}
          >
            Register company
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tenant sign-in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={signInTenantId}
            onChange={(event) => setSignInTenantId(event.target.value)}
            placeholder="Tenant ID"
          />
          <Input
            value={signInEmail}
            onChange={(event) => setSignInEmail(event.target.value)}
            placeholder="Email"
          />
          <Input
            type="password"
            value={signInPassword}
            onChange={(event) => setSignInPassword(event.target.value)}
            placeholder="Password"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                busy || !signInTenantId || !signInEmail || !signInPassword
              }
              onClick={signIn}
            >
              Sign in
            </Button>
            <Button
              disabled={busy || !status.authenticated}
              onClick={signOut}
              variant="outline"
            >
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Register tenant users and admins</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600">
            Only signed-in tenant admins can create users.
          </p>
          <Input
            value={newUserName}
            onChange={(event) => setNewUserName(event.target.value)}
            placeholder="Full name"
          />
          <Input
            value={newUserEmail}
            onChange={(event) => setNewUserEmail(event.target.value)}
            placeholder="Email"
          />
          <Input
            type="password"
            value={newUserPassword}
            onChange={(event) => setNewUserPassword(event.target.value)}
            placeholder="Password"
          />
          <Select
            value={newUserRole}
            onValueChange={(value) => setNewUserRole(value as "ADMIN" | "USER")}
          >
            <SelectTrigger>
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USER">User</SelectItem>
              <SelectItem value="ADMIN">Admin</SelectItem>
            </SelectContent>
          </Select>
          <Button
            disabled={
              busy ||
              !status.authenticated ||
              status.user?.role !== "ADMIN" ||
              !newUserName ||
              !newUserEmail ||
              !newUserPassword
            }
            onClick={registerUser}
          >
            Register tenant user
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
