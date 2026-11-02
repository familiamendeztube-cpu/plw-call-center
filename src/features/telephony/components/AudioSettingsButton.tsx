import { useState } from 'react';
import { AudioLines, Settings2 } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';

const DEVICE_FIELDS = [
  { id: 'microphone', label: 'Micrófono' },
  { id: 'speaker', label: 'Altavoz' },
] as const;

export function AudioSettingsButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" size="sm" className="w-full" onClick={() => setOpen(true)}>
        <Settings2 size={14} aria-hidden="true" />
        Ajustes de audio
      </Button>
      <Dialog
        open={open}
        title="Ajustes de audio"
        description="Las llamadas usan el micrófono y el altavoz predeterminados de este equipo."
        onClose={() => setOpen(false)}
        footer={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cerrar
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {DEVICE_FIELDS.map((field) => (
            <div key={field.id}>
              <label
                htmlFor={`audio-${field.id}`}
                className="mb-1.5 block text-sm font-medium text-neutral-700"
              >
                {field.label}
              </label>
              <select
                id={`audio-${field.id}`}
                disabled
                className="h-10 w-full rounded-lg border border-neutral-300 bg-neutral-100 px-3 text-sm text-neutral-500"
                defaultValue="pending"
              >
                <option value="pending">Predeterminado del equipo</option>
              </select>
            </div>
          ))}
          <p className="flex items-start gap-2 rounded-lg bg-plw-ivory px-3 py-2.5 text-xs leading-relaxed text-neutral-600">
            <AudioLines size={14} className="mt-0.5 shrink-0 text-plw-gold" aria-hidden="true" />
            Para usar otro dispositivo, cámbialo en los ajustes de sonido del equipo.
          </p>
        </div>
      </Dialog>
    </>
  );
}
