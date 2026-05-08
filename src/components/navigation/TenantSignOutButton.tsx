"use client";

import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/client";
import { useRouter } from "next/navigation";
import * as React from "react";

export default function TenantSignOutButton() {
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);

    try {
      await fetchJson("/api/auth/tenant/logout", { method: "POST" });
      router.push("/auth/signin");
      router.refresh();
    } catch {
      router.push("/auth/signin");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <Button variant="outline" onClick={handleSignOut} disabled={signingOut}>
      {signingOut ? "Signing out..." : "Sign out"}
    </Button>
  );
}
