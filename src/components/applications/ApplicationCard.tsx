"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useDraggable } from "@dnd-kit/core";
import * as React from "react";
import {
  type BoardDensity,
  type GroupedApplication,
  isPlacementRequirementsMissing,
} from "./types";

type ApplicationCardProps = {
  groupedApplication: GroupedApplication;
  density: BoardDensity;
  onEdit: () => void;
  onCompletePlacement: () => void;
};

export default React.memo(function ApplicationCard({
  groupedApplication,
  density,
  onEdit,
  onCompletePlacement,
}: ApplicationCardProps) {
  const application = groupedApplication.representative;
  const compact = density === "COMPACT";
  const placementMissing = isPlacementRequirementsMissing(application);
  const companyName = application.job.company?.name?.trim() || "";
  const roleDescription = application.job.rawText?.trim() || "";
  const opportunityEmail = application.job.opportunityEmail?.trim() || "";
  const opportunityUrl = application.job.opportunityUrl?.trim() || "";
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: groupedApplication.id,
    });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <Card
      ref={setNodeRef as never}
      style={style}
      className={`cursor-pointer ${isDragging ? "opacity-60" : ""}`}
    >
      <CardHeader
        className={compact ? "space-y-2 px-3 py-2" : "space-y-2 px-3 py-3"}
      >
        <div className="flex items-start justify-end gap-2">
          <button
            type="button"
            className={`rounded border border-slate-200 uppercase text-slate-500 dark:border-slate-600 dark:text-slate-400 ${
              compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-1 text-[10px]"
            }`}
            onClick={(event) => event.stopPropagation()}
            {...listeners}
            {...attributes}
          >
            Drag
          </button>
        </div>
        <div
          className={compact ? "space-y-1 text-[11px]" : "space-y-1 text-xs"}
        >
          <CardField
            compact={compact}
            label="Candidate"
            value={application.candidate.fullName}
          />
          {companyName ? (
            <CardField compact={compact} label="Company" value={companyName} />
          ) : null}
          <CardField
            compact={compact}
            label="Role"
            value={application.job.title}
          />
          {roleDescription ? (
            <p
              className={`grid items-start ${
                compact
                  ? "grid-cols-[64px_1fr] gap-1.5"
                  : "grid-cols-[74px_1fr] gap-2"
              }`}
            >
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Description
              </span>
              <span
                className={`break-words text-slate-600 dark:text-slate-400 ${
                  compact ? "line-clamp-1" : "line-clamp-2"
                }`}
                title={roleDescription}
              >
                {roleDescription}
              </span>
            </p>
          ) : null}
          {opportunityEmail ? (
            <CardField
              compact={compact}
              label="Email"
              value={opportunityEmail}
            />
          ) : null}
          {opportunityUrl ? (
            <p
              className={`grid items-center ${
                compact
                  ? "grid-cols-[64px_1fr] gap-1.5"
                  : "grid-cols-[74px_1fr] gap-2"
              }`}
            >
              <span className="font-medium text-slate-700 dark:text-slate-300">
                URL
              </span>
              <a
                href={opportunityUrl}
                target="_blank"
                rel="noreferrer"
                className="truncate text-slate-600 underline dark:text-slate-400"
                title={opportunityUrl}
                onClick={(event) => event.stopPropagation()}
              >
                {opportunityUrl}
              </a>
            </p>
          ) : null}
        </div>
      </CardHeader>
      <CardContent
        className={
          compact ? "space-y-1.5 px-3 pb-3 pt-0" : "space-y-2 px-3 pb-3 pt-0"
        }
      >
        {placementMissing ? (
          <Badge
            className={`border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-400 ${
              compact ? "text-[10px]" : "text-xs"
            }`}
          >
            Missing contract/rate
          </Badge>
        ) : null}
        <div className={compact ? "flex gap-1.5" : "flex gap-2"}>
          <Button
            type="button"
            className={compact ? "h-7 px-2 text-xs" : "h-8 px-3 text-sm"}
            aria-label={`Edit ${application.candidate.fullName} for ${application.job.title}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onEdit();
            }}
          >
            Edit
          </Button>
          {application.currentStage === "PLACED" ? (
            <Button
              type="button"
              variant="outline"
              className={compact ? "h-7 px-2 text-xs" : "h-8 px-3 text-sm"}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onCompletePlacement();
              }}
            >
              Contract/rate
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
});

function CardField({
  compact,
  label,
  value,
}: {
  compact: boolean;
  label: string;
  value: string;
}) {
  return (
    <p
      className={`grid items-center ${
        compact ? "grid-cols-[64px_1fr] gap-1.5" : "grid-cols-[74px_1fr] gap-2"
      }`}
    >
      <span className="font-medium text-slate-700 dark:text-slate-300">
        {label}
      </span>
      <span
        className="truncate text-slate-600 dark:text-slate-400"
        title={value}
      >
        {value}
      </span>
    </p>
  );
}
