import { useState } from 'react';
import { formatDateTime } from '@/app/dates';
import { useAsync } from '@/app/useAsync';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { useAgentNames } from '@/features/auth/hooks/useAgentNames';
import { getSupabaseClient } from '@/integrations/supabase/client';

interface AuditEvent {
  id: number;
  actor_id: string | null;
  action: string;
  target_id: string | null;
  detail: Record<string, unknown>;
  occurred_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  'dental_dialer.running': 'Activó el marcador de Anna',
  'dental_dialer.paused': 'Pausó el marcador de Anna',
  'dental_dialer.stopped': 'Detuvo el marcador de Anna',
  'staff.create': 'Agregó un agente',
  'staff.update': 'Editó un agente',
  'credential.set': 'Cambió el PIN de un agente',
  'sip_account.set': 'Asignó un teléfono a un agente',
  'device.enrollment_created': 'Creó un código para registrar un equipo',
  'device.revoke': 'Quitó el acceso de un equipo',
  'prospect.reassign': 'Reasignó un cliente',
  'inquiry.create': 'Registró una consulta',
  'material.save': 'Guardó un material comercial',
  'material.delete': 'Eliminó un material comercial',
  'setting.update': 'Cambió una configuración',
  'gmail_sync.set': 'Cambió la sincronización de Gmail',
};

const GROUPS: Record<string, { label: string; prefixes: string[] }> = {
  all: { label: 'Todo', prefixes: [''] },
  anna: { label: 'Marcador de Anna', prefixes: ['dental_dialer.'] },
  staff: {
    label: 'Agentes y accesos',
    prefixes: ['staff.', 'credential.', 'sip_account.', 'device.'],
  },
  customers: { label: 'Clientes', prefixes: ['prospect.', 'inquiry.'] },
  settings: {
    label: 'Configuración y material',
    prefixes: ['setting.', 'material.', 'gmail_sync.'],
  },
};

async function loadAudit(): Promise<AuditEvent[]> {
  const { data, error } = await getSupabaseClient()
    .from('admin_audit_events')
    .select('id, actor_id, action, target_id, detail, occurred_at')
    .order('occurred_at', { ascending: false })
    .limit(300);
  if (error) throw new Error('No se pudo cargar el registro.');
  return (data ?? []) as AuditEvent[];
}

/** Who did what: the record the 2026-11-10 dialer activation was missing. */
export function AdminAuditPage() {
  const { state, reload } = useAsync(loadAudit, []);
  const names = useAgentNames();
  const [group, setGroup] = useState('all');
  const who = (id: string | null) =>
    id === null ? 'Sistema' : (names[id] ?? (id.startsWith('admin-') ? 'Administrador' : id));

  const describe = (event: AuditEvent) => {
    const detail = event.detail ?? {};
    const parts = [ACTION_LABELS[event.action] ?? event.action];
    if (event.target_id?.startsWith('agent-')) parts.push(who(event.target_id));
    if (typeof detail.title === 'string') parts.push(`«${detail.title}»`);
    if (typeof detail.to === 'string') parts.push(`a ${who(detail.to)}`);
    if (typeof detail.reason === 'string' && detail.reason) parts.push(`(${detail.reason})`);
    if (typeof detail.error === 'string') parts.push(`· ${detail.error}`);
    if (event.action === 'setting.update')
      parts.push(`${event.target_id} = ${String(detail.value)}`);
    return parts.join(' ');
  };

  const visible =
    state.status === 'ready'
      ? state.data.filter((event) =>
          GROUPS[group].prefixes.some((prefix) => event.action.startsWith(prefix))
        )
      : [];

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Registro"
        description="Quién hizo qué: activaciones de Anna, cambios de agentes, reasignaciones y configuración. Las 300 acciones más recientes."
        actions={
          <Button variant="secondary" size="sm" onClick={reload}>
            Actualizar
          </Button>
        }
      />
      <label className="flex max-w-xs flex-col gap-1.5 text-sm">
        <span className="font-medium text-neutral-700">Mostrar</span>
        <select
          value={group}
          onChange={(event) => setGroup(event.target.value)}
          className="h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-plw-ink"
        >
          {Object.entries(GROUPS).map(([key, { label }]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {state.status === 'loading' ? (
        <StatusMessage tone="loading" title="Cargando registro..." />
      ) : null}
      {state.status === 'error' ? <StatusMessage tone="error" title={state.message} /> : null}
      {state.status === 'ready' && visible.length === 0 ? (
        <StatusMessage tone="empty" title="No hay acciones registradas." />
      ) : null}
      {visible.length > 0 ? (
        <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200/80 bg-white">
          {visible.map((event) => (
            <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
              <time dateTime={event.occurred_at} className="w-32 shrink-0 text-xs text-neutral-500">
                {formatDateTime(event.occurred_at)}
              </time>
              <span className="text-sm font-semibold text-plw-ink">{who(event.actor_id)}</span>
              <span className="min-w-0 flex-1 text-sm text-neutral-700">{describe(event)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
