import DemoTourWrapper from "@/components/demo/DemoTourWrapper";
import { isDemoInstance } from "@/lib/demoMode";

export default function CandidateSignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Redirect on demo is handled in middleware.ts (runs before this layout).
  const isDemo = isDemoInstance();

  return isDemo ? <DemoTourWrapper>{children}</DemoTourWrapper> : children;
}
