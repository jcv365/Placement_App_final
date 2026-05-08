"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import * as React from "react";
import {
  type ApplicationStage,
  type BoardDensity,
  type BoardSort,
  type PipelineViewFilter,
  STAGES,
  STAGE_LABELS,
} from "./types";

type ApplicationFiltersProps = {
  quickSearch: string;
  onQuickSearchChange: (value: string) => void;
  pipelineView: PipelineViewFilter;
  onPipelineViewChange: (value: PipelineViewFilter) => void;
  filterStage: ApplicationStage | "ALL";
  onFilterStageChange: (value: ApplicationStage | "ALL") => void;
  boardDensity: BoardDensity;
  onBoardDensityChange: (value: BoardDensity) => void;
  showAdvancedFilters: boolean;
  onToggleAdvancedFilters: () => void;
  filterCandidateEmail: string;
  onFilterCandidateEmailChange: (value: string) => void;
  filterCompanyName: string;
  onFilterCompanyNameChange: (value: string) => void;
  filterRole: string;
  onFilterRoleChange: (value: string) => void;
  boardSort: BoardSort;
  onBoardSortChange: (value: BoardSort) => void;
  groupedOnly: boolean;
  onGroupedOnlyChange: (value: boolean) => void;
  activeFilterCount: number;
  onClearFilters: () => void;
  onSetActiveView: () => void;
  onSetPlacedView: () => void;
  onSetMissingDocsView: () => void;
};

export default function ApplicationFilters({
  quickSearch,
  onQuickSearchChange,
  pipelineView,
  onPipelineViewChange,
  filterStage,
  onFilterStageChange,
  boardDensity,
  onBoardDensityChange,
  showAdvancedFilters,
  onToggleAdvancedFilters,
  filterCandidateEmail,
  onFilterCandidateEmailChange,
  filterCompanyName,
  onFilterCompanyNameChange,
  filterRole,
  onFilterRoleChange,
  boardSort,
  onBoardSortChange,
  groupedOnly,
  onGroupedOnlyChange,
  activeFilterCount,
  onClearFilters,
  onSetActiveView,
  onSetPlacedView,
  onSetMissingDocsView,
}: ApplicationFiltersProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Filters</CardTitle>
          <Badge>{activeFilterCount} active</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <Input
            value={quickSearch}
            onChange={(event) => onQuickSearchChange(event.target.value)}
            placeholder="Search candidate, role, company or opportunity"
            className="sm:col-span-2 md:col-span-2 lg:col-span-2"
          />
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            value={pipelineView}
            onChange={(event) =>
              onPipelineViewChange(event.target.value as PipelineViewFilter)
            }
          >
            <option value="ALL">All pipeline states</option>
            <option value="ACTIVE">Active pipeline only</option>
            <option value="PLACED_ONLY">Placed only</option>
            <option value="INACTIVE">Rejected and on hold</option>
            <option value="PLACEMENT_ISSUES">
              Placed with missing docs/rate
            </option>
          </select>
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            value={filterStage}
            onChange={(event) =>
              onFilterStageChange(
                event.target.value as ApplicationStage | "ALL",
              )
            }
          >
            <option value="ALL">All stages</option>
            {STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {STAGE_LABELS[stage]}
              </option>
            ))}
          </select>
          <Button variant="outline" onClick={onToggleAdvancedFilters}>
            {showAdvancedFilters ? "Hide advanced" : "Show advanced"}
          </Button>
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            value={boardDensity}
            onChange={(event) =>
              onBoardDensityChange(event.target.value as BoardDensity)
            }
          >
            <option value="COMPACT">Density: Compact</option>
            <option value="COMFORTABLE">Density: Comfortable</option>
          </select>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClearFilters}>
              Clear
            </Button>
          </div>
        </div>

        {showAdvancedFilters ? (
          <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 dark:border-slate-700">
            <Input
              value={filterCandidateEmail}
              onChange={(event) =>
                onFilterCandidateEmailChange(event.target.value)
              }
              placeholder="Candidate email"
            />
            <Input
              value={filterCompanyName}
              onChange={(event) =>
                onFilterCompanyNameChange(event.target.value)
              }
              placeholder="Company name"
            />
            <Input
              value={filterRole}
              onChange={(event) => onFilterRoleChange(event.target.value)}
              placeholder="Role title"
            />
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              value={boardSort}
              onChange={(event) =>
                onBoardSortChange(event.target.value as BoardSort)
              }
            >
              <option value="UPDATED_DESC">Newest updates first</option>
              <option value="UPDATED_ASC">Oldest updates first</option>
              <option value="GROUP_SIZE_DESC">
                Largest grouped cards first
              </option>
            </select>
            <label className="flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <input
                type="checkbox"
                checked={groupedOnly}
                onChange={(event) => onGroupedOnlyChange(event.target.checked)}
              />
              Grouped only
            </label>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={onSetActiveView}>
            Active view
          </Button>
          <Button variant="outline" onClick={onSetPlacedView}>
            Placed view
          </Button>
          <Button variant="outline" onClick={onSetMissingDocsView}>
            Missing placement docs
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
