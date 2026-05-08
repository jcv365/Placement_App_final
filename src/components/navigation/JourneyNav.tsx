"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavGroup = {
  title: string;
  items: Array<{ href: string; label: string; hint: string }>;
};

const navGroups: NavGroup[] = [
  {
    title: "Dashboard",
    items: [
      {
        href: "/overview",
        label: "Overview",
        hint: "View KPIs, queue snapshots, and key actions.",
      },
    ],
  },
  {
    title: "Ingest",
    items: [
      {
        href: "/ingest/linkedin-feed",
        label: "LinkedIn feed",
        hint: "Review cron-ingested opportunities with source and timestamp.",
      },
      {
        href: "/jobs",
        label: "Jobs",
        hint: "Upload jobs manually and manage ingested role records.",
      },
      {
        href: "/candidates",
        label: "Candidates",
        hint: "Upload candidates, review vetting, and manage profiles.",
      },
    ],
  },
  {
    title: "Match Review",
    items: [
      {
        href: "/match-review",
        label: "Review queue",
        hint: "Review matches, inspect draft emails, and approve or reject.",
      },
      {
        href: "/email-log",
        label: "Email log",
        hint: "Search generated emails by date and candidate. See what has not been emailed yet.",
      },
    ],
  },
  {
    title: "Applications",
    items: [
      {
        href: "/applications",
        label: "Kanban board",
        hint: "Track application progression from new to placed.",
      },
      {
        href: "/opportunity-recommendations",
        label: "Opportunity recommendations",
        hint: "Pick an engineer and rank the best-fit opportunities.",
      },
    ],
  },
  {
    title: "Clients",
    items: [
      {
        href: "/clients",
        label: "Clients",
        hint: "Manage client accounts, contacts, and relationships.",
      },
      {
        href: "/vacancies",
        label: "Vacancies",
        hint: "Track vacancy pipeline and candidate associations.",
      },
    ],
  },
  {
    title: "Finance",
    items: [
      {
        href: "/timesheets",
        label: "Timesheets",
        hint: "Log engineer hours, review month-to-date totals, and export CSV.",
      },
    ],
  },
  {
    title: "Settings",
    items: [
      {
        href: "/settings",
        label: "AI and rules",
        hint: "Configure LiteLLM, rules, tone, and templates.",
      },
      {
        href: "/admin",
        label: "Admin portal",
        hint: "Manage company branding, finance settings, and monthly reports.",
      },
    ],
  },
];

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function JourneyNav({
  layout = "inline",
}: {
  layout?: "inline" | "sidebar";
}) {
  const pathname = usePathname();
  const navOptions = navGroups.flatMap((group) =>
    group.items.map((item) => ({
      href: item.href,
      label: item.label,
      hint: item.hint,
      section: group.title,
    })),
  );

  const activeOption = navOptions.find((option) =>
    isActivePath(pathname, option.href),
  );

  if (layout === "sidebar") {
    return (
      <nav className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
          Navigation
        </p>
        <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
          {navGroups.map((group) => (
            <div key={group.title} className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                {group.title}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const active = isActivePath(pathname, item.href);
                  return (
                    <Link
                      key={`${item.href}-${item.label}`}
                      href={item.href}
                      className={
                        active
                          ? "block rounded border border-slate-900 bg-slate-900 px-2 py-1 text-xs font-medium text-white"
                          : "block rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      }
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {activeOption ? (
          <p className="text-[11px] text-slate-600">{activeOption.hint}</p>
        ) : null}
        <div className="pt-1">
          <Button asChild variant="outline">
            <Link href="/auth/signout" prefetch={false}>
              Sign out
            </Link>
          </Button>
        </div>
      </nav>
    );
  }

  return (
    <nav className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
        Navigation
      </p>
      <div className="flex flex-wrap gap-1.5">
        {navOptions.map((option) => {
          const active = isActivePath(pathname, option.href);
          return (
            <Link
              key={`${option.href}-${option.label}`}
              href={option.href}
              className={
                active
                  ? "rounded border border-slate-900 bg-slate-900 px-2 py-1 text-xs font-medium text-white"
                  : "rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              }
            >
              {`${option.section}: ${option.label}`}
            </Link>
          );
        })}
      </div>
      {activeOption ? (
        <p className="text-[11px] text-slate-600">
          {activeOption.section}: {activeOption.hint}
        </p>
      ) : null}
    </nav>
  );
}
