import { CheckCircle2, UserRound } from 'lucide-react';
import type { Agent, AgentId } from '@/features/auth/models/agent';
import { cx } from '@/components/ui/cx';

interface AgentCardSelectorProps {
  agents: Agent[];
  selectedId: AgentId | null;
  onSelect: (agentId: AgentId) => void;
  disabled?: boolean;
}

export function AgentCardSelector({
  agents,
  selectedId,
  onSelect,
  disabled,
}: AgentCardSelectorProps) {
  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      role="radiogroup"
      aria-label="Selecciona tu agente"
    >
      {agents.map((agent) => {
        const selected = agent.id === selectedId;
        return (
          <button
            key={agent.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onSelect(agent.id)}
            className={cx(
              'group relative flex items-center gap-3 rounded-[18px] border p-4 text-left transition-all duration-200',
              'hover:-translate-y-0.5 hover:shadow-panel disabled:cursor-not-allowed disabled:opacity-60',
              selected
                ? 'border-plw-gold bg-plw-surface-strong shadow-panel ring-1 ring-plw-gold/40'
                : 'border-white/10 bg-white/[0.04] hover:border-plw-gold/60'
            )}
          >
            <span
              className={cx(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors',
                selected ? 'bg-plw-navy text-white' : 'bg-white/10 text-plw-gold-soft'
              )}
            >
              <UserRound size={18} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-plw-ink">{agent.displayName}</span>
              <span className="block text-xs text-neutral-500">Espacio de trabajo</span>
            </span>
            {selected ? (
              <CheckCircle2 size={18} className="text-plw-gold" aria-hidden="true" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
