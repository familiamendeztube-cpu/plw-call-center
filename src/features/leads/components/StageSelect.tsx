import { useState, type ChangeEvent } from 'react';
import { useAppServices } from '@/app/ServicesContext';
import { SALES_STAGE_LABELS, SALES_STAGES, type Prospect } from '@/features/leads/models/prospect';
import { cx } from '@/components/ui/cx';

interface StageSelectProps {
  prospect: Prospect;
  onChange: (prospect: Prospect) => void;
  compact?: boolean;
}

export function StageSelect({ prospect, onChange, compact = false }: StageSelectProps) {
  const { leads } = useAppServices();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    const stage = SALES_STAGES.find((item) => item === event.target.value);
    if (!stage || stage === prospect.stage) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onChange(await leads.updateStage(prospect.id, stage));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cambiar la etapa.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={compact ? '' : 'flex flex-col gap-1.5'}>
      {compact ? null : (
        <label htmlFor={`stage-${prospect.id}`} className="text-sm font-medium text-neutral-700">
          Etapa de venta
        </label>
      )}
      <select
        id={`stage-${prospect.id}`}
        value={prospect.stage}
        onChange={handleChange}
        disabled={saving}
        className={cx(
          'h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-plw-ink',
          'hover:border-neutral-400 focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30',
          'disabled:opacity-60',
          compact ? 'w-full' : 'w-full sm:w-64'
        )}
      >
        {SALES_STAGES.map((stage) => (
          <option key={stage} value={stage}>
            {SALES_STAGE_LABELS[stage]}
          </option>
        ))}
      </select>
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
