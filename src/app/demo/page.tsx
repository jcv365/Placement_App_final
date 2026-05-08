import { isDemoInstance } from "@/lib/demoMode";
import { redirect } from "next/navigation";
import DemoPageClient from "./DemoPageClient";

export default function DemoPage() {
  if (!isDemoInstance()) {
    redirect("/auth/signin");
  }
  return <DemoPageClient />;
}
