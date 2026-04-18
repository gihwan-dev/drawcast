// Bottom-right toast stack. Renders all entries from `toastStore` as an
// elevated pill; the store owns the 3s auto-dismiss so this component is
// just a view + click-to-dismiss.
//
// Positioned at z-index 200 per the UI design doc's toast layer.
import { useToastStore, type Toast } from '../store/toastStore.js';

export function ToastStack(): JSX.Element | null {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      data-testid="dc-toast-stack"
      className="pointer-events-none fixed bottom-dc-md right-dc-md z-[200] flex flex-col items-end gap-dc-xs"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: Toast;
  onDismiss(): void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps): JSX.Element {
  const colorClass =
    toast.kind === 'error'
      ? 'border-dc-status-danger text-dc-status-danger'
      : toast.kind === 'success'
        ? 'border-dc-status-success text-dc-text-primary'
        : 'border-dc-border-hairline text-dc-text-primary';

  return (
    <button
      type="button"
      data-testid="dc-toast-item"
      data-kind={toast.kind}
      onClick={onDismiss}
      className={`pointer-events-auto rounded-dc-md border bg-dc-bg-elevated px-dc-md py-dc-sm text-[13px] shadow-dc-e2 ${colorClass}`}
    >
      {toast.message}
    </button>
  );
}
