import { Button } from '@/components/ui/Button';
import { setAiCallStatus, useAiCalls } from '@/features/ai-calls/hooks/useAiCalls';
import { AiCallCard } from '@/features/ai-calls/components/AiCallCard';
import { contactNumber, type AiCall } from '@/features/ai-calls/models/aiCall';

/** Banner on the agent's customer page: their pending AI requests, one click to open each. */
export function AiCallAlerts({ onSelect }: { onSelect: (prospectId: string) => void }) {
  const { state, updateData } = useAiCalls({ status: 'pending' });
  if (state.status !== 'ready') return null;
  const pending = state.data.filter((call) => call.prospectId);
  if (pending.length === 0) return null;

  // Opening a request from the banner means the agent started on it: it leaves the banner
  // and moves to "En proceso" before the card loads, so the card shows the same status.
  async function open(call: AiCall) {
    updateData((list) => list.filter((item) => item.id !== call.id));
    await setAiCallStatus(call.id, 'in_progress').catch(() => undefined);
    onSelect(call.prospectId as string);
  }

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
          <Button key={call.id} variant="secondary" size="sm" onClick={() => void open(call)}>
            {call.customerName ?? contactNumber(call) ?? 'Llamada IA'}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** The AI requests of one customer. Renders nothing when there are none. */
export function AiCallPanel({
  prospectId,
  agentNames,
  className = 'flex max-h-[45vh] flex-col gap-3 overflow-y-auto border-b border-neutral-200 bg-plw-ivory/60 p-4',
}: {
  prospectId: string;
  agentNames: Record<string, string>;
  className?: string;
}) {
  const { state, refresh, reload } = useAiCalls({ prospectId });
  if (state.status === 'loading') return null;
  // A failed load used to render nothing, which looked like a call with no details.
  if (state.status === 'error') {
    return (
      <div role="alert" className={className}>
        <p className="text-sm text-danger-700">{state.message}</p>
        <Button variant="secondary" size="sm" className="self-start" onClick={reload}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (state.data.length === 0) return null;

  return (
    <section aria-label="Llamadas atendidas por el asistente IA" className={className}>
      {state.data.map((call) => (
        <AiCallCard key={call.id} call={call} agentNames={agentNames} canDial onChanged={refresh} />
      ))}
    </section>
  );
}
