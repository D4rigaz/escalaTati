import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle } from 'lucide-react';

export default function ConfirmDialog({ open, onOpenChange, title, description, onConfirm, confirmLabel = 'Confirmar', variant = 'danger' }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
          <div className="flex gap-4">
            <div className="shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
              <AlertTriangle size={20} className="text-red-600" />
            </div>
            <div>
              <Dialog.Title className="font-semibold text-gray-900 mb-1">{title}</Dialog.Title>
              <Dialog.Description className="text-sm text-gray-600">{description}</Dialog.Description>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <Dialog.Close asChild>
              <button className="btn-secondary">Cancelar</button>
            </Dialog.Close>
            <button
              className={variant === 'danger' ? 'btn-danger' : 'btn-primary'}
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
