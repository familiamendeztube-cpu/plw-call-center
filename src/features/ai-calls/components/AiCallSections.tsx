import { Button } from '@/components/ui/Button';
import { useAiCalls } from '@/features/ai-calls/hooks/useAiCalls';
import { AiCallCard } from '@/features/ai-calls/components/AiCallCard';
import { contactNumber } from '@/features/ai-calls/models/aiCall';

/** Banner on the agent's customer page: their pending AI requests, one click to open each. */
export function AiCallAlerts({ onSelect }: { onSelect: (prospectId: string) => void }) {
  const { state } = useAiCalls({ status: 'pending' });
  if (state.status !== 'ready') return null;
  const pending = state.data.filter((call) => call.prospectId);
  if (pending.length === 0) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-plw-navy/20 bg-plw-navy/5 px-5 py-3"
    >
      <p className="text-sm font-medium text-plw-navy">
        {pending.length === 1
          ? 'Tienes una solicitud pendiente del asistente IA.'
          : `Tienes ${pending.length} solicitudes pendientes del asistente IA.`}
      </p>
      <div className="flex flex-wrap gap-2">
        {pending.slice(0, 5).map((call) => (
          <Button
            key={call.id}
            variant="secondary"
            size="sm"
            onClick={() => onSelect(call.prospectId as string)}
          >
            {call.customerName ?? contactNumber(call) ?? 'Llamada IA'}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** The AI requests of one customer, shown above the customer's tabs. Renders nothing when none. */
export function AiCallPanel({
  prospectId,
  agentNames,
}: {
  prospectId: string;
  agentNames: Record<string, string>;
}) {
  const { state, refresh } = useAiCalls({ prospectId });
  if (state.status !== 'ready' || state.data.length === 0) return null;

  return (
    <section
      aria-label="Llamadas atendidas por el asistente IA"
      className="flex max-h-[45vh] flex-col gap-3 overflow-y-auto border-b border-neutral-200 bg-plw-ivory/60 p-4"
    >
      {state.data.map((call) => (
        <AiCallCard key={call.id} call={call} agentNames={agentNames} canDial onChanged={refresh} />
      ))}
    </section>
  );
}
