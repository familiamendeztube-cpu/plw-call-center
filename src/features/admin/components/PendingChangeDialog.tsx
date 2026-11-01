import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';

interface PendingChangeDialogProps {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}

export function PendingChangeDialog({
  open,
  title,
  description,
  onClose,
  children,
}: PendingChangeDialogProps) {
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          <Button disabled>Guardar cambios</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex gap-3 rounded-lg border border-warning-100 bg-warning-50 p-4 text-sm text-warning-700">
          <ShieldAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            Este cambio requiere la conexión con el servidor de cuentas. Mientras tanto, los
            controles están desactivados y no se modifica ningún dato.
          </p>
        </div>
        <fieldset disabled className="flex flex-col gap-5 opacity-70">
          {children}
        </fieldset>
      </div>
    </Dialog>
  );
}
