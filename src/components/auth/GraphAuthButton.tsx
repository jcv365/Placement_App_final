"use client";

import { Button } from "@/components/ui/button";
import { getInitialisedMsalInstance } from "@/lib/msal";
import * as React from "react";

const SCOPES = (process.env.NEXT_PUBLIC_GRAPH_SCOPES ?? "").split(" ");
const REDIRECT_URI =
  process.env.NEXT_PUBLIC_AAD_REDIRECT_URI ?? "http://localhost:3001";

export default function GraphAuthButton() {
  const [status, setStatus] = React.useState("Not signed in");

  const signIn = async () => {
    try {
      const msalInstance = await getInitialisedMsalInstance();
      const result = await msalInstance.loginPopup({
        scopes: SCOPES,
        redirectUri: REDIRECT_URI,
      });
      const token = result.accessToken;
      localStorage.removeItem("graphAccessToken");
      sessionStorage.setItem("graphAccessToken", token);
      setStatus("Signed in for Microsoft Graph");
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  return (
    <div className="space-y-2">
      <Button onClick={signIn}>Sign in for Graph</Button>
      <p className="text-xs text-slate-500">{status}</p>
    </div>
  );
}
