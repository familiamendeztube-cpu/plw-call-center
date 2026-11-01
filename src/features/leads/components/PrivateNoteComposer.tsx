import { useState, type FormEvent } from 'react';
import { useAppServices } from '@/app/ServicesContext';
import type { AgentId } from '@/features/auth/models/agent';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';

interface PrivateNoteComposerProps {
  prospectId: string;
  agentId: AgentId;
  onSaved: () => void;
}

export function PrivateNoteComposer({ prospectId, agentId, onSaved }: PrivateNoteComposerProps) {
  const { leads } = useAppServices();
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await leads.addNote({ prospectId, agentId, body });
      setBody('');
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la nota.');
    } finally {
      setSaving(false);
    }
  };

  const canSave = body.trim().length > 0 && !saving;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label htmlFor="private-note" className="text-sm font-medium text-neutral-700">
        Nueva nota privada
      </label>
      <textarea
        id="private-note"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Visible solo para tu equipo. El cliente no la verá."
        className={cx(
          'w-full resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm text-plw-ink',
          'placeholder:text-neutral-400 focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30'
        )}
      />
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger-700">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" size="sm" disabled={!canSave}>
          {saving ? 'Guardando...' : 'Guardar nota'}
        </Button>
      </div>
    </form>
  );
}
