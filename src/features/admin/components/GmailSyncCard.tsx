import { useState, type FormEvent, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { IS_DEMO_MODE } from '@/app/appConfig';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { TextField } from '@/components/ui/TextField';
import { useGmailSync } from '@/features/admin/hooks/useGmailSync';
import {
  gmailSyncLabel,
  gmailSyncState,
  type GmailSyncState,
} from '@/features/admin/models/gmailSync';

const dateFormatter = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

function formatDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : 'Todavía no';
}

function localDateValue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const TONE_BY_STATE: Record<GmailSyncState, BadgeTone> = {
  disconnected: 'warning',
  error: 'danger',
  paused: 'neutral',
  importing: 'navy',
  waiting: 'gold',
  synced: 'success',
};

export function GmailSyncCard() {
  if (IS_DEMO_MODE) {
    return (
      <SyncCardFrame badge={<Badge tone="neutral">Modo demostración</Badge>}>
        <p className="rounded-lg bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
          La recepción de correos solo está disponible en la versión conectada al servidor.
        </p>
      </SyncCardFrame>
    );
  }
  return <LiveGmailSyncCard />;
}

function LiveGmailSyncCard() {
  const { state, reload, busy, actionError, refreshError, setRunning, setImportFrom } =
    useGmailSync();
  const [dateDraft, setDateDraft] = useState<string | null>(null);

  if (state.status === 'loading') {
    return (
      <SyncCardFrame>
        <StatusMessage tone="loading" title="Cargando la recepción de correos" />
      </SyncCardFrame>
    );
  }

  if (state.status === 'error') {
    return (
      <SyncCardFrame>
        <StatusMessage
          tone="error"
          title="No se pudo cargar la recepción de correos"
          description={state.message}
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Reintentar
            </Button>
          }
        />
      </SyncCardFrame>
    );
  }

  const status = state.data;
  const shownDate = dateDraft ?? localDateValue(status.importFrom);

  function handleDateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dateDraft) return;
    const importFrom = new Date(`${dateDraft}T00:00:00`).toISOString();
    setImportFrom(importFrom).then((saved) => {
      if (saved) setDateDraft(null);
    });
  }

  return (
    <SyncCardFrame
      badge={<Badge tone={TONE_BY_STATE[gmailSyncState(status)]}>{gmailSyncLabel(status)}</Badge>}
    >
      {refreshError ? <StatusMessage tone="info" title={refreshError} /> : null}

      <dl className="grid gap-3 rounded-lg bg-neutral-50 px-4 py-3 sm:grid-cols-2">
        <SyncFact label="Última sincronización correcta" value={formatDate(status.lastSuccessAt)} />
        <SyncFact label="Importa correos desde" value={formatDate(status.importFrom)} />
      </dl>

      {status.lastError ? (
        <StatusMessage
          tone="error"
          title={`Último error · ${formatDate(status.lastErrorAt)}`}
          description={status.lastError}
        />
      ) : null}

      {actionError ? (
        <StatusMessage
          tone="error"
          title="No se pudo guardar el cambio"
          description={actionError}
        />
      ) : null}

      {!status.connected ? (
        <p className="text-sm text-neutral-600">
          Conecte la cuenta de Google Workspace antes de iniciar la sincronización.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {status.isRunning ? (
          <Button variant="secondary" size="sm" onClick={() => setRunning(false)} disabled={busy}>
            {busy ? 'Guardando…' : 'Pausar sincronización'}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setRunning(true)}
            disabled={busy || !status.connected}
          >
            <RefreshCw size={16} aria-hidden="true" />
            {busy ? 'Guardando…' : 'Iniciar sincronización'}
          </Button>
        )}
      </div>

      <form
        onSubmit={handleDateSubmit}
        className="flex flex-col gap-3 border-t border-neutral-200 pt-5"
      >
        <TextField
          label="Fecha inicial de importación"
          type="date"
          value={shownDate}
          max={localDateValue(new Date().toISOString())}
          onChange={(event) => setDateDraft(event.target.value)}
          hint="Por defecto se importan los correos recibidos desde la activación. Cambiar la fecha reinicia la importación desde esa fecha."
        />
        <div>
          <Button type="submit" variant="secondary" size="sm" disabled={busy || !dateDraft}>
            Guardar fecha inicial
          </Button>
        </div>
      </form>
    </SyncCardFrame>
  );
}

function SyncFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-plw-ink">{value}</dd>
    </div>
  );
}

function SyncCardFrame({ badge, children }: { badge?: ReactNode; children?: ReactNode }) {
  return (
    <Panel as="article" className="flex flex-col gap-5 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-plw-ink">Recepción de correos</h2>
          <p className="mt-1 text-sm text-neutral-600">
            El servidor revisa el buzón cada minuto aunque nadie tenga la aplicación abierta.
          </p>
        </div>
        {badge}
      </div>
      {children}
    </Panel>
  );
}
