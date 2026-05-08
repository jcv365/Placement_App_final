import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

const quickActions: Array<{
  href: string;
  title: string;
  description: string;
}> = [
  {
    href: "/applications",
    title: "Applications board",
    description:
      "Track movement across each stage and action candidates quickly.",
  },
  {
    href: "/match-review",
    title: "Match review",
    description: "Review fit scoring and approve draft communications.",
  },
  {
    href: "/jobs",
    title: "Ingest jobs",
    description: "Upload or review role intake records for processing.",
  },
  {
    href: "/candidates",
    title: "Candidates",
    description:
      "Maintain candidate profiles, vetting, and placement readiness.",
  },
  {
    href: "/timesheets",
    title: "Timesheets",
    description: "Monitor approved hours and monthly finance progress.",
  },
  {
    href: "/settings",
    title: "Settings",
    description: "Manage AI behaviour, rules, templates, and integrations.",
  },
];

export default function OverviewPage() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Dashboard overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-700">
          <p>Use this overview as your starting point for daily operations.</p>
          <p>Select a workflow below to continue.</p>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {quickActions.map((action) => (
          <Card key={action.href}>
            <CardHeader>
              <CardTitle className="text-base">{action.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">{action.description}</p>
              <Button asChild size="sm">
                <Link href={action.href}>Open</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
