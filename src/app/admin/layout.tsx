import DemoTourWrapper from "@/components/demo/DemoTourWrapper";
import { isDemoInstance } from "@/lib/demoMode";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isDemo = isDemoInstance();

  return isDemo ? <DemoTourWrapper>{children}</DemoTourWrapper> : children;
}
