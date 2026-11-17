import { useId, useState, type FormEvent } from 'react';
import { useAppServices } from '@/app/ServicesContext';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/TextField';
import {
  MATERIAL_KIND_LABELS,
  type MaterialKind,
  type SalesMaterial,
} from '@/features/sales-materials/models/material';
import type { MaterialInput } from '@/features/sales-materials/services/materialService';

const KINDS = Object.keys(MATERIAL_KIND_LABELS) as MaterialKind[];

/** Add or edit a material. The file itself lives elsewhere (Drive, YouTube...): this is its link. */
export function MaterialEditorDialog({
  material,
  onClose,
  onSaved,
}: {
  /** Null adds a new one. */
  material: SalesMaterial | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { materials } = useAppServices();
  const formId = useId();
  const [input, setInput] = useState<MaterialInput>({
    id: material?.id ?? null,
    title: material?.title ?? '',
    description: material?.description ?? '',
    kind: material?.kind ?? 'presentation',
    url: material?.url ?? '',
    approved: material?.approval === 'approved',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof MaterialInput>(key: K, value: MaterialInput[K]) =>
    setInput((current) => ({ ...current, [key]: value }));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (input.url.trim() && !input.url.trim().startsWith('https://')) {
      setError('El enlace debe empezar con https://.');
      return;
    }
    if (input.approved && !input.url.trim()) {
      setError('Para aprobarlo, agrega el enlace.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await materials.saveMaterial({ ...input, url: input.url.trim() });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el material.');
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title={material ? 'Editar material' : 'Nuevo material'}
      description="Los agentes lo abren y lo envían a los clientes solo cuando está aprobado."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void save(event)} className="grid gap-4">
        <TextField
          label="Título"
          value={input.title}
          maxLength={160}
          required
          onChange={(event) => set('title', event.target.value)}
        />
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-neutral-700">Tipo</span>
          <select
            value={input.kind}
            onChange={(event) => set('kind', event.target.value as MaterialKind)}
            className="h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-plw-ink"
          >
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {MATERIAL_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-neutral-700">Descripción</span>
          <textarea
            value={input.description}
            maxLength={600}
            rows={3}
            onChange={(event) => set('description', event.target.value)}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-plw-ink"
          />
        </label>
        <TextField
          label="Enlace (https://...)"
          type="url"
          value={input.url}
          maxLength={2000}
          placeholder="https://drive.google.com/..."
          onChange={(event) => set('url', event.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={input.approved}
            onChange={(event) => set('approved', event.target.checked)}
            className="h-4 w-4"
          />
          Aprobado: los agentes pueden enviarlo
        </label>
        {error ? (
          <p role="alert" className="text-sm text-danger-700">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
