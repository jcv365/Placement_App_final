import DemoTourWrapper from "@/components/demo/DemoTourWrapper";
import DashboardBreadcrumb from "@/components/navigation/DashboardBreadcrumb";
import JourneyNav from "@/components/navigation/JourneyNav";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { APP_SESSION_COOKIE, getAppSessionFromToken } from "@/lib/appAuth";
import { isDemoInstance } from "@/lib/demoMode";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(APP_SESSION_COOKIE)?.value;
  const session = getAppSessionFromToken(sessionToken);

  if (!session) {
    redirect("/auth/signin");
  }

  const [tenant, company] = await Promise.all([
    prisma.tenant.findUnique({
      where: { tenantId: session.tid },
      select: { displayName: true },
    }),
    prisma.company.findFirst({
      where: { tenantId: session.tid },
      orderBy: { createdAt: "asc" },
      select: { name: true },
    }),
  ]);

  const signedInAs = tenant?.displayName ?? company?.name ?? session.tid;
  const isDemo = isDemoInstance();

  const dashboardContent = (
    <div className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[240px_1fr]">
      <aside className="h-fit lg:sticky lg:top-6">
        <JourneyNav layout="sidebar" />
      </aside>
      <main id="main-content" className="w-full space-y-3">
        <DashboardBreadcrumb />
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </div>
  );

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-slate-900 focus:shadow"
      >
        Skip to main content
      </a>
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link
            href={isDemo ? "/demo" : "/overview"}
            className="text-lg font-semibold text-slate-900"
          >
            Contract Placements
          </Link>
          {isDemo ? (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
              🔒 Read-Only Demo
            </span>
          ) : (
            <p className="text-sm text-slate-600">
              Signed in as: <span className="font-medium">{signedInAs}</span>
            </p>
          )}
          <div className="flex items-center gap-2">
            {!isDemo && (
              <Button asChild>
                <Link href="/jobs">Upload</Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href={isDemo ? "/demo" : "/auth/signout"} prefetch={false}>
                {isDemo ? "← Demo Hub" : "Sign out"}
              </Link>
            </Button>
          </div>
        </div>
      </header>
      {isDemo ? (
        <DemoTourWrapper>{dashboardContent}</DemoTourWrapper>
      ) : (
        dashboardContent
      )}
    </div>
  );
}
