"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function toLabel(segment: string): string {
  return segment
    .replace(/-/g, " ")
    .replace(/\b\w/g, (part) => part.toUpperCase());
}

export default function DashboardBreadcrumb() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);

  if (parts.length === 0) {
    return <p className="text-xs text-slate-500">Home</p>;
  }

  return (
    <nav aria-label="Breadcrumb" className="text-xs text-slate-500">
      <ol className="flex flex-wrap items-center gap-1">
        <li>
          <Link href="/overview" className="hover:text-slate-700">
            Home
          </Link>
        </li>
        {parts.map((part, index) => {
          const href = `/${parts.slice(0, index + 1).join("/")}`;
          const last = index === parts.length - 1;

          return (
            <li key={href} className="flex items-center gap-1">
              <span>/</span>
              {last ? (
                <span className="font-medium text-slate-700">
                  {toLabel(part)}
                </span>
              ) : (
                <Link href={href} className="hover:text-slate-700">
                  {toLabel(part)}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
