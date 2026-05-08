"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  /** Use `description` or `message` — both are supported. */
  description?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Called when confirmed. */
  onConfirm: () => void;
  /** Called when the dialog is dismissed. Supports both APIs. */
  onOpenChange?: (open: boolean) => void;
  onCancel?: () => void;
  /** When true the confirm button uses red styling. */
  destructive?: boolean;
}

export function ConfirmDialog({
  open,
  title = "Confirm",
  description,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onOpenChange,
  onCancel,
  destructive = false,
}: ConfirmDialogProps) {
  const body = description ?? message ?? "";

  const handleDismiss = (v: boolean) => {
    if (!v) {
      onCancel?.();
      onOpenChange?.(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleDismiss}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-600">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => handleDismiss(false)}>
            {cancelLabel}
          </Button>
          <Button
            className={destructive ? "bg-red-600 hover:bg-red-700" : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ConfirmDialog;
