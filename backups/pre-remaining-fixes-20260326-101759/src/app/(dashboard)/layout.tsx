import DashboardBreadcrumb from "@/components/navigation/DashboardBreadcrumb";
import JourneyNav from "@/components/navigation/JourneyNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { APP_SESSION_COOKIE, getAppSessionFromToken } from "@/lib/appAuth";
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

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link
            href="/overview"
            className="text-lg font-semibold text-slate-900"
          >
            Contract Placements
          </Link>
          <p className="text-sm text-slate-600">
            Signed in as: <span className="font-medium">{signedInAs}</span>
          </p>
          <div className="flex items-center gap-2">
            <Input
              className="w-64"
              placeholder="Search jobs, candidates, companies"
              aria-label="Global search"
            />
            <Button asChild>
              <Link href="/jobs">Upload</Link>
            </Button>
            <Button className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50">
              Notifications
            </Button>
            <Button asChild variant="outline">
              <Link href="/auth/signout" prefetch={false}>
                Sign out
              </Link>
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[240px_1fr]">
        <aside className="h-fit lg:sticky lg:top-6">
          <JourneyNav layout="sidebar" />
        </aside>
        <main className="w-full space-y-3">
          <DashboardBreadcrumb />
          {children}
        </main>
      </div>
    </div>
  );
}
