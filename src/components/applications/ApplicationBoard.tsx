"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Input } from "@/components/ui/input";
import { SuccessBanner } from "@/components/ui/success-banner";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import Link from "next/link";
import ApplicationDetailDrawer from "./ApplicationDetailDrawer";
import ApplicationFilters from "./ApplicationFilters";
import { BoardSkeleton } from "./BoardSkeleton";
import KanbanColumn from "./KanbanColumn";
import { STAGES, STAGE_LABELS } from "./types";
import { useApplicationBoard } from "./useApplicationBoard";

export default function ApplicationBoard() {
  const board = useApplicationBoard();
  const sensors = useSensors(useSensor(PointerSensor));

  if (board.loading) {
    return <BoardSkeleton />;
  }

  return (
    <div className="w-full space-y-6">
      {/* Banners with aria-live for screen reader announcements */}
      <div aria-live="polite" aria-atomic="true">
        {board.actionError ? (
          <ErrorBanner
            message={board.actionError}
            onDismiss={board.dismissError}
          />
        ) : null}
        {board.successMessage ? (
          <SuccessBanner
            message={board.successMessage}
            onDismiss={board.dismissSuccess}
          />
        ) : null}
      </div>
      {board.placementMissingCount > 0 ? (
        <ErrorBanner
          message={`${board.placementMissingCount} placed application(s) still require signed contract upload and agreed hourly rate.`}
        />
      ) : null}

      <div className="flex items-center justify-between">
        <div>
          <h1>Applications</h1>
          <div className="flex items-center gap-2">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Drag cards between stages to update status.
            </p>
            <Badge>AI: {board.activeAiProvider}</Badge>
          </div>
        </div>
        <Button onClick={board.applyFilters}>Refresh</Button>
      </div>

      <ApplicationFilters
        quickSearch={board.quickSearch}
        onQuickSearchChange={board.setQuickSearch}
        pipelineView={board.pipelineView}
        onPipelineViewChange={board.setPipelineView}
        filterStage={board.filterStage}
        onFilterStageChange={board.setFilterStage}
        boardDensity={board.boardDensity}
        onBoardDensityChange={board.setBoardDensity}
        showAdvancedFilters={board.showAdvancedFilters}
        onToggleAdvancedFilters={() => board.setShowAdvancedFilters((c) => !c)}
        filterCandidateEmail={board.filterCandidateEmail}
        onFilterCandidateEmailChange={board.setFilterCandidateEmail}
        filterCompanyName={board.filterCompanyName}
        onFilterCompanyNameChange={board.setFilterCompanyName}
        filterRole={board.filterRole}
        onFilterRoleChange={board.setFilterRole}
        boardSort={board.boardSort}
        onBoardSortChange={board.setBoardSort}
        groupedOnly={board.groupedOnly}
        onGroupedOnlyChange={board.setGroupedOnly}
        activeFilterCount={board.activeFilterCount}
        onClearFilters={board.clearFilters}
        onSetActiveView={() => {
          board.setPipelineView("ACTIVE");
          board.setFilterStage("ALL");
        }}
        onSetPlacedView={() => {
          board.setPipelineView("PLACED_ONLY");
          board.setFilterStage("PLACED");
        }}
        onSetMissingDocsView={() => {
          board.setPipelineView("PLACEMENT_ISSUES");
          board.setFilterStage("PLACED");
        }}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Stage summary</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 pt-2">
          {STAGES.map((stage) => {
            const count = board.visibleGroupedApplications.filter(
              (item) => item.stage === stage,
            ).length;
            return (
              <Badge key={stage}>
                {STAGE_LABELS[stage]}: {count}
              </Badge>
            );
          })}
        </CardContent>
      </Card>

      <DndContext
        sensors={sensors}
        onDragStart={(event) => board.setActiveId(String(event.active.id))}
        onDragEnd={board.onDragEnd}
      >
        {board.visibleGroupedApplications.length === 0 ? (
          <Card>
            <CardContent className="space-y-3 py-6">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                No applications yet.
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Start by uploading opportunities, then review matched candidates
                and generate drafts to create applications.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href="/jobs">Upload opportunities</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/candidates">Review candidates</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Scroll horizontally to view all stages.
          </p>
        )}
        <div className="overflow-x-auto pb-2" style={{ overflowX: "auto" }}>
          <div
            className="flex min-w-max flex-nowrap items-start gap-4"
            style={{
              display: "flex",
              flexWrap: "nowrap",
              width: "max-content",
            }}
          >
            {STAGES.map((stage) => {
              const items = board.visibleGroupedApplications.filter(
                (item) => item.stage === stage,
              );
              return (
                <KanbanColumn
                  key={stage}
                  id={stage}
                  title={STAGE_LABELS[stage]}
                  items={items}
                  density={board.boardDensity}
                  onEdit={(id) => board.openDetails(id)}
                  onCompletePlacement={(id) => {
                    const app = board.applications.find((a) => a.id === id);
                    if (app) board.openPlacementModal(app);
                  }}
                />
              );
            })}
          </div>
        </div>
        <DragOverlay>
          {board.activeId ? (
            <div className="rounded-md bg-white px-3 py-2 shadow dark:bg-slate-700 dark:text-slate-200">
              Moving...
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Placement details dialog */}
      <Dialog
        open={!!board.placementTarget}
        onOpenChange={(open: boolean) => {
          if (!open && !board.savingPlacement) {
            board.setPlacementTarget(null);
            board.setPlacementBillingModel("");
            board.setPlacementFeePercent("");
            board.setPlacementAnnualCtc("");
            board.setPlacementContractValue("");
            board.setPlacementContractFile(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Placement details</DialogTitle>
          </DialogHeader>
          {board.placementTarget ? (
            <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
              <p>
                Candidate:{" "}
                <strong>{board.placementTarget.candidateName}</strong>
              </p>
              <p>
                Role: <strong>{board.placementTarget.roleTitle}</strong>
              </p>

              <div className="space-y-1">
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Billing model
                </p>
                <select
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                  value={board.placementBillingModel}
                  onChange={(event) =>
                    board.setPlacementBillingModel(event.target.value)
                  }
                >
                  <option value="">Select billing model…</option>
                  <option value="EOR_MARGIN">
                    Ongoing margin – EOR (20–30%)
                  </option>
                  <option value="INDEPENDENT_CONTRACTOR_MARGIN">
                    Ongoing margin – Independent Contractor (10–20%)
                  </option>
                  <option value="ONCE_OFF_PLACEMENT_FEE">
                    Once-off contracting placement fee (5–10%)
                  </option>
                  <option value="PERMANENT_PLACEMENT_FEE">
                    Permanent conversion fee (10–20% of CTC)
                  </option>
                </select>
              </div>

              {board.placementBillingModel ? (
                <div className="space-y-1">
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Agreed fee percentage
                  </p>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={board.placementFeePercent}
                    onChange={(event) =>
                      board.setPlacementFeePercent(event.target.value)
                    }
                    placeholder="e.g. 25"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {board.placementBillingModel === "EOR_MARGIN" &&
                      "Typical range: 20–30%"}
                    {board.placementBillingModel ===
                      "INDEPENDENT_CONTRACTOR_MARGIN" &&
                      "Typical range: 10–20%"}
                    {board.placementBillingModel === "ONCE_OFF_PLACEMENT_FEE" &&
                      "Typical range: 5–10% of total contract value"}
                    {board.placementBillingModel ===
                      "PERMANENT_PLACEMENT_FEE" &&
                      "Typical range: 10–20% of annual CTC"}
                  </p>
                </div>
              ) : null}

              {(board.placementBillingModel === "EOR_MARGIN" ||
                board.placementBillingModel ===
                  "INDEPENDENT_CONTRACTOR_MARGIN") && (
                <div className="space-y-1">
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Agreed hourly rate
                  </p>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={board.placementRate}
                    onChange={(event) =>
                      board.setPlacementRate(event.target.value)
                    }
                    disabled={board.placementTarget.agreedHourlyRate !== null}
                    placeholder="Enter agreed hourly rate"
                  />
                  {board.placementTarget.agreedHourlyRate !== null ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Rate locked at{" "}
                      {board.placementTarget.agreedHourlyRate.toFixed(2)}.
                    </p>
                  ) : null}
                </div>
              )}

              {board.placementBillingModel === "PERMANENT_PLACEMENT_FEE" && (
                <div className="space-y-1">
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Annual cost to company (CTC)
                  </p>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={board.placementAnnualCtc}
                    onChange={(event) =>
                      board.setPlacementAnnualCtc(event.target.value)
                    }
                    placeholder="Enter annual CTC"
                  />
                </div>
              )}

              {board.placementBillingModel === "ONCE_OFF_PLACEMENT_FEE" && (
                <div className="space-y-1">
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Total contract value
                  </p>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={board.placementContractValue}
                    onChange={(event) =>
                      board.setPlacementContractValue(event.target.value)
                    }
                    placeholder="Enter total contract value"
                  />
                </div>
              )}

              <div className="space-y-1">
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Signed contract upload
                </p>
                <Input
                  type="file"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                  onChange={(event) =>
                    board.setPlacementContractFile(
                      event.target.files?.[0] ?? null,
                    )
                  }
                />
                {board.placementTarget.signedContractFileName ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Uploaded: {board.placementTarget.signedContractFileName}
                  </p>
                ) : (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Contract file is required for placed applications.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    board.setPlacementTarget(null);
                    board.setPlacementBillingModel("");
                    board.setPlacementFeePercent("");
                    board.setPlacementAnnualCtc("");
                    board.setPlacementContractValue("");
                  }}
                  disabled={board.savingPlacement}
                >
                  Cancel
                </Button>
                <Button
                  onClick={board.handleSavePlacementDetails}
                  disabled={board.savingPlacement}
                >
                  {board.savingPlacement
                    ? "Saving..."
                    : "Save placement details"}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ApplicationDetailDrawer
        selected={board.selected}
        onClose={() => board.setSelected(null)}
        editFullName={board.editFullName}
        onEditFullName={board.setEditFullName}
        editEmail={board.editEmail}
        onEditEmail={board.setEditEmail}
        editPhone={board.editPhone}
        onEditPhone={board.setEditPhone}
        editHourlyRate={board.editHourlyRate}
        onEditHourlyRate={board.setEditHourlyRate}
        savingDetails={board.savingDetails}
        onSaveDetails={board.handleSaveDetails}
        noteContent={board.noteContent}
        onNoteContentChange={board.setNoteContent}
        addingNote={board.addingNote}
        onAddNote={board.handleAddNote}
        lifecycleAction={board.lifecycleAction}
        onLifecycleActionChange={board.setLifecycleAction}
        lifecycleReason={board.lifecycleReason}
        onLifecycleReasonChange={board.setLifecycleReason}
        runningLifecycleAction={board.runningLifecycleAction}
        onLifecycleAction={board.handleLifecycleAction}
        generatingEmailDraft={board.generatingEmailDraft}
        onGenerateEmail={() => {
          if (!board.selected) return;
          board.handleGenerateEmail({
            id: board.selected.id,
            job: { id: board.selected.job.id },
            candidate: { id: board.selected.candidate.id },
          });
        }}
        draftTo={board.draftTo}
        onDraftToChange={board.setDraftTo}
        creatingDraft={board.creatingDraft}
        onCreateDraft={board.handleCreateDraft}
        selectedEmailDraftId={board.selectedEmailDraftId}
        onSelectEmailDraft={board.setSelectedEmailDraftId}
        selectedEmail={board.selectedEmail}
        savingLearningPreference={board.savingLearningPreference}
        onMarkAsLearningReference={board.handleMarkAsLearningReference}
        onCopySubject={board.handleCopySubject}
        onCopyBody={board.handleCopyBody}
        onCopyFullEmail={board.handleCopyFullEmail}
        onDeleteOtherDrafts={board.handleDeleteOtherDrafts}
        confirmDeleteDrafts={board.confirmDeleteDrafts}
        onConfirmDeleteDrafts={board.executeDeleteOtherDrafts}
        onCancelDeleteDrafts={() => board.setConfirmDeleteDrafts(false)}
        emailGenerationBlock={board.emailGenerationBlock ?? null}
        onDismissEmailGenerationBlock={board.dismissEmailGenerationBlock}
      />
    </div>
  );
}
