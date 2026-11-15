import { useState, type ReactNode } from 'react';
import { errorMessage } from '../lib/errors.ts';
import { Alert, Button, Dialog, DialogBody, DialogContent, DialogFooter } from '../ui/index.ts';

/** "Are you sure?" for an action that changes data. Shows the API's error if it fails. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  confirmDisabled = false,
  children,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  /** Extra content (a warning, a choice) shown above the buttons. */
  children?: ReactNode;
  onConfirm: () => Promise<unknown>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent title={title} description={description} className="max-w-md">
        {error || children ? (
          <DialogBody className="flex flex-col gap-3">
            {children}
            {error && <Alert tone="danger">{error}</Alert>}
          </DialogBody>
        ) : (
          <div className="h-4" />
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            loading={pending}
            disabled={confirmDisabled}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
