"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { DetailData, LifecycleActionType } from "./types";
import { LIFECYCLE_ACTIONS } from "./types";

type ApplicationDetailDrawerProps = {
  selected: DetailData | null;
  onClose: () => void;
  editFullName: string;
  onEditFullName: (v: string) => void;
  editEmail: string;
  onEditEmail: (v: string) => void;
  editPhone: string;
  onEditPhone: (v: string) => void;
  editHourlyRate: string;
  onEditHourlyRate: (v: string) => void;
  savingDetails: boolean;
  onSaveDetails: () => void;
  noteContent: string;
  onNoteContentChange: (v: string) => void;
  addingNote: boolean;
  onAddNote: () => void;
  lifecycleAction: LifecycleActionType;
  onLifecycleActionChange: (v: LifecycleActionType) => void;
  lifecycleReason: string;
  onLifecycleReasonChange: (v: string) => void;
  runningLifecycleAction: boolean;
  onLifecycleAction: () => void;
  generatingEmailDraft: boolean;
  onGenerateEmail: () => void;
  draftTo: string;
  onDraftToChange: (v: string) => void;
  creatingDraft: boolean;
  onCreateDraft: (emailDraftId?: string) => void;
  selectedEmailDraftId: string | null;
  onSelectEmailDraft: (id: string) => void;
  selectedEmail: {
    id: string;
    subject: string;
    htmlBody: string;
    preferredForLearning?: boolean;
    createdAt: string;
  } | null;
  savingLearningPreference: boolean;
  onMarkAsLearningReference: () => void;
  onCopySubject: () => void;
  onCopyBody: () => void;
  onCopyFullEmail: () => void;
  onDeleteOtherDrafts: () => void;
  confirmDeleteDrafts: boolean;
  onConfirmDeleteDrafts: () => void;
  onCancelDeleteDrafts: () => void;
  emailGenerationBlock: {
    message: string;
    hallucinatedClaims: string[];
    atsScore?: number;
    hint?: string;
  } | null;
  onDismissEmailGenerationBlock: () => void;
};

export default function ApplicationDetailDrawer({
  selected,
  onClose,
  editFullName,
  onEditFullName,
  editEmail,
  onEditEmail,
  editPhone,
  onEditPhone,
  editHourlyRate,
  onEditHourlyRate,
  savingDetails,
  onSaveDetails,
  noteContent,
  onNoteContentChange,
  addingNote,
  onAddNote,
  lifecycleAction,
  onLifecycleActionChange,
  lifecycleReason,
  onLifecycleReasonChange,
  runningLifecycleAction,
  onLifecycleAction,
  generatingEmailDraft,
  onGenerateEmail,
  draftTo,
  onDraftToChange,
  creatingDraft,
  onCreateDraft,
  selectedEmailDraftId,
  onSelectEmailDraft,
  selectedEmail,
  savingLearningPreference,
  onMarkAsLearningReference,
  onCopySubject,
  onCopyBody,
  onCopyFullEmail,
  onDeleteOtherDrafts,
  confirmDeleteDrafts,
  onConfirmDeleteDrafts,
  onCancelDeleteDrafts,
  emailGenerationBlock,
  onDismissEmailGenerationBlock,
}: ApplicationDetailDrawerProps) {
  return (
    <>
      <Dialog
        open={!!selected}
        onOpenChange={(open: boolean) => !open && onClose()}
      >
        <DialogContent className="max-h-[92vh] w-[95vw] max-w-5xl overflow-hidden p-0">
          {selected && (
            <div className="max-h-[92vh] overflow-y-auto p-6 pr-4">
              <DialogHeader>
                <DialogTitle>Application detail</DialogTitle>
              </DialogHeader>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Job text</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm text-slate-600 dark:text-slate-400">
                      {selected.job.rawText}
                    </pre>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Candidate CV text</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm text-slate-600 dark:text-slate-400">
                      {selected.candidate.rawCV}
                    </pre>
                  </CardContent>
                </Card>
              </div>

              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Candidate details
                  </h3>
                  <Input
                    value={editFullName}
                    onChange={(event) => onEditFullName(event.target.value)}
                    placeholder="Candidate name"
                  />
                  <Input
                    value={editEmail}
                    onChange={(event) => onEditEmail(event.target.value)}
                    placeholder="Candidate email"
                  />
                  <Input
                    value={editPhone}
                    onChange={(event) => onEditPhone(event.target.value)}
                    placeholder="Candidate contact number"
                  />
                  <Input
                    value={editHourlyRate}
                    onChange={(event) => onEditHourlyRate(event.target.value)}
                    placeholder="Hourly rate (for example £85/hr)"
                  />
                  <Button onClick={onSaveDetails} disabled={savingDetails}>
                    {savingDetails ? "Saving..." : "Save details"}
                  </Button>

                  {selected.job.company?.name?.trim() ? (
                    <>
                      <h3 className="pt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                        Company details
                      </h3>
                      <Input
                        value={selected.job.company?.name ?? ""}
                        readOnly
                      />
                    </>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Notes
                  </h3>
                  <Textarea
                    value={noteContent}
                    onChange={(event) =>
                      onNoteContentChange(event.target.value)
                    }
                    placeholder="Add a note"
                    className="min-h-64"
                  />
                  <Button onClick={onAddNote} disabled={addingNote}>
                    {addingNote ? "Saving\u2026" : "Save note"}
                  </Button>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Contract lifecycle actions
                  </h3>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    value={lifecycleAction}
                    onChange={(event) =>
                      onLifecycleActionChange(
                        event.target.value as LifecycleActionType,
                      )
                    }
                  >
                    {LIFECYCLE_ACTIONS.map((action) => (
                      <option key={action.value} value={action.value}>
                        {action.label}
                      </option>
                    ))}
                  </select>
                  <Textarea
                    value={lifecycleReason}
                    onChange={(event) =>
                      onLifecycleReasonChange(event.target.value)
                    }
                    placeholder="Reason for this action (required)"
                    className="min-h-24"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    These actions update stage and create auditable
                    notes/history to cover scenarios like contract stop,
                    termination, access revocation, and restoration.
                  </p>
                  <Button
                    onClick={onLifecycleAction}
                    disabled={runningLifecycleAction}
                  >
                    {runningLifecycleAction
                      ? "Applying action..."
                      : "Apply lifecycle action"}
                  </Button>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Create Outlook draft
                  </h3>
                  <Button
                    onClick={onGenerateEmail}
                    disabled={generatingEmailDraft}
                  >
                    {generatingEmailDraft
                      ? "Generating email..."
                      : "Generate email"}
                  </Button>
                  {emailGenerationBlock && (
                    <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                          {emailGenerationBlock.message}
                        </p>
                        <button
                          type="button"
                          onClick={onDismissEmailGenerationBlock}
                          className="shrink-0 text-red-500 hover:text-red-700 dark:text-red-400"
                          aria-label="Dismiss"
                        >
                          ✕
                        </button>
                      </div>
                      {emailGenerationBlock.hint && (
                        <p className="mt-1 text-xs text-red-700 dark:text-red-400">
                          {emailGenerationBlock.hint}
                        </p>
                      )}
                      {emailGenerationBlock.hallucinatedClaims.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs font-semibold text-red-800 dark:text-red-300">
                            Invented claims detected:
                          </p>
                          <ul className="mt-1 list-inside list-disc space-y-0.5">
                            {emailGenerationBlock.hallucinatedClaims.map(
                              (claim, i) => (
                                <li
                                  key={i}
                                  className="text-xs text-red-700 dark:text-red-400"
                                >
                                  {claim}
                                </li>
                              ),
                            )}
                          </ul>
                        </div>
                      )}
                      {emailGenerationBlock.atsScore !== undefined && (
                        <p className="mt-2 text-xs text-red-700 dark:text-red-400">
                          ATS score:{" "}
                          <span className="font-semibold">
                            {emailGenerationBlock.atsScore}
                          </span>
                        </p>
                      )}
                    </div>
                  )}
                  <Input
                    value={draftTo}
                    onChange={(event) => onDraftToChange(event.target.value)}
                    placeholder="Recipient email(s), comma separated"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Recipient is auto-filled from extracted job contact email
                    when available.
                  </p>
                  <Button
                    onClick={() =>
                      onCreateDraft(selectedEmailDraftId ?? undefined)
                    }
                    disabled={creatingDraft}
                  >
                    {creatingDraft ? "Creating\u2026" : "Create draft"}
                  </Button>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Sign in first to store a Graph token.
                  </p>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Email drafts
                </h3>
                {(selected.emails?.length ?? 0) === 0 ? (
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    No email drafts yet.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {(selected.emails ?? []).map((email) => (
                      <button
                        key={email.id}
                        type="button"
                        onClick={() => onSelectEmailDraft(email.id)}
                        className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                          selectedEmailDraftId === email.id
                            ? "border-slate-400 bg-slate-100 dark:border-slate-500 dark:bg-slate-700"
                            : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
                        }`}
                      >
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          {email.subject}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {new Date(email.createdAt).toLocaleString("en-GB")}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Email preview
                </h3>
                {!selectedEmail ? (
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Select an email draft to view it.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                        {selectedEmail.subject}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          onClick={onMarkAsLearningReference}
                          disabled={
                            savingLearningPreference ||
                            selectedEmail.preferredForLearning === true
                          }
                        >
                          {selectedEmail.preferredForLearning
                            ? "Learning reference saved"
                            : savingLearningPreference
                              ? "Saving..."
                              : "Use as learning reference"}
                        </Button>
                        <Button onClick={onCopySubject}>Copy subject</Button>
                        <Button onClick={onCopyBody}>Copy body</Button>
                        <Button onClick={onCopyFullEmail}>
                          Copy full email
                        </Button>
                        <Button onClick={onDeleteOtherDrafts}>
                          Delete other drafts
                        </Button>
                      </div>
                    </div>
                    <div
                      className="max-h-64 overflow-auto rounded border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700 sm:max-h-72 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      dangerouslySetInnerHTML={{
                        __html: selectedEmail.htmlBody,
                      }}
                    />
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  History
                </h3>
                <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-400">
                  {(selected.history ?? []).map((entry) => (
                    <li key={entry.id}>
                      {entry.fromStage ?? "Start"} → {entry.toStage}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDeleteDrafts}
        title="Delete other drafts"
        message="Delete all other drafts for this application and keep the selected draft?"
        confirmLabel="Delete"
        onConfirm={onConfirmDeleteDrafts}
        onCancel={onCancelDeleteDrafts}
      />
    </>
  );
}
