"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchJson } from "@/lib/client";
import * as React from "react";

type DeviceStartResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

type DevicePollResponse = {
  status: "pending" | "ok";
  reason?: "authorization_pending" | "slow_down";
  accessToken?: string;
};

export default function GithubDeviceLogin() {
  const [clientId, setClientId] = React.useState("");
  const [deviceCode, setDeviceCode] = React.useState<string | null>(null);
  const [pollIntervalSeconds, setPollIntervalSeconds] = React.useState(5);
  const [userCode, setUserCode] = React.useState<string | null>(null);
  const [verificationUri, setVerificationUri] = React.useState<string | null>(
    null,
  );
  const [status, setStatus] = React.useState<string>("Not connected");
  const [loading, setLoading] = React.useState(false);

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const loadConnectionStatus = React.useCallback(async () => {
    const localToken = localStorage.getItem("githubAccessToken")?.trim();

    try {
      const response = await fetch("/api/ai/status", {
        method: "GET",
        credentials: "include",
      });

      if (response.ok) {
        const payload = (await response.json()) as {
          data?: {
            githubConnected?: boolean;
          };
        };

        if (payload.data?.githubConnected) {
          await fetch("/api/auth/github/device/sync", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          setStatus("Connected to GitHub Models");
          return;
        }

        if (localToken) {
          await fetch("/api/auth/github/device/sync", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessToken: localToken }),
          });
          setStatus("Connected to GitHub Models");
          return;
        }
      }
    } catch {}

    if (localToken) {
      setStatus("Connected to GitHub Models");
    }
  }, []);

  React.useEffect(() => {
    const savedClientId = localStorage.getItem("githubOAuthClientId") ?? "";
    setClientId(savedClientId);
    void loadConnectionStatus();
  }, [loadConnectionStatus]);

  React.useEffect(() => {
    const onFocus = () => {
      void loadConnectionStatus();
    };

    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [loadConnectionStatus]);

  const saveClientId = () => {
    localStorage.setItem("githubOAuthClientId", clientId.trim());
    setStatus("Client ID saved for this browser profile.");
  };

  const startLogin = async () => {
    if (!clientId.trim()) {
      setStatus("Enter and save your GitHub OAuth client ID first.");
      return;
    }

    setLoading(true);
    try {
      const data = await fetchJson<DeviceStartResponse>(
        "/api/auth/github/device/start",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: clientId.trim() || undefined }),
        },
      );

      setDeviceCode(data.device_code);
      setPollIntervalSeconds(Math.max(1, data.interval || 5));
      setUserCode(data.user_code);
      setVerificationUri(data.verification_uri);
      setStatus(
        "Authorise the device code in GitHub, then click Complete sign-in to finish automatically.",
      );
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const completeLogin = async () => {
    if (!deviceCode) return;
    if (!clientId.trim()) {
      setStatus("Enter and save your GitHub OAuth client ID first.");
      return;
    }

    setLoading(true);
    try {
      setStatus("Checking GitHub authorisation...");

      for (let attempt = 0; attempt < 18; attempt += 1) {
        const data = await fetchJson<DevicePollResponse>(
          "/api/auth/github/device/poll",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              deviceCode,
              clientId: clientId.trim() || undefined,
            }),
          },
        );

        if (data.status === "ok" && data.accessToken) {
          localStorage.setItem("githubAccessToken", data.accessToken);
          localStorage.setItem("aiProvider", "github-models");
          setStatus("Connected to GitHub Models");
          return;
        }

        setStatus(
          data.reason === "slow_down"
            ? "GitHub asked to slow down polling. Waiting and retrying..."
            : "Still waiting for GitHub authorisation. Keep this page open...",
        );

        await sleep(pollIntervalSeconds * 1000);
      }

      setStatus(
        "Still waiting for GitHub authorisation. If you already approved, click Complete sign-in again.",
      );
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const disconnect = async () => {
    try {
      await fetchJson<{ status: "ok" }>("/api/auth/github/device/disconnect", {
        method: "POST",
      });
    } catch {}

    localStorage.removeItem("githubAccessToken");
    localStorage.removeItem("aiProvider");
    setDeviceCode(null);
    setPollIntervalSeconds(5);
    setUserCode(null);
    setVerificationUri(null);
    setStatus("Disconnected");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>GitHub Models (device login)</CardTitle>
        <p className="text-sm text-slate-600">
          Connect your GitHub account and use GitHub Models for email
          generation.
        </p>
        <p className="text-sm text-slate-600">
          Complete device login once, and this workspace can reuse the
          connection until you disconnect.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-700">{status}</p>

        <div className="space-y-2">
          <label
            className="text-sm font-medium text-slate-700"
            htmlFor="githubClientId"
          >
            GitHub OAuth client ID
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="githubClientId"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="Paste your GitHub OAuth client ID"
            />
            <Button type="button" variant="outline" onClick={saveClientId}>
              Save
            </Button>
          </div>
        </div>

        {userCode && verificationUri ? (
          <div className="rounded-md border border-slate-200 p-3 text-sm">
            <p>
              Code: <strong>{userCode}</strong>
            </p>
            <p>
              URL:{" "}
              <a
                className="text-blue-700 underline"
                href={verificationUri}
                target="_blank"
                rel="noreferrer"
              >
                {verificationUri}
              </a>
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button onClick={startLogin} disabled={loading}>
            {loading ? "Working..." : "Start device login"}
          </Button>
          <Button
            variant="outline"
            onClick={completeLogin}
            disabled={loading || !deviceCode || !clientId.trim()}
          >
            Complete sign-in
          </Button>
          <Button variant="ghost" onClick={disconnect}>
            Disconnect
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
