import { useState, type ReactNode } from 'react';
import { Mail, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { IS_DEMO_MODE } from '@/app/appConfig';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Panel } from '@/components/ui/Panel';
import { StatusMessage } from '@/components/ui/StatusMessage';
import {
  GOOGLE_MAILBOX_ADDRESS,
  googleStatusLabel,
  type GoogleConnection,
  type GoogleWorkspaceStatus,
} from '@/features/admin/models/googleWorkspace';
import { useGoogleWorkspace, type GoogleNotice } from '@/features/admin/hooks/useGoogleWorkspace';
import { cx } from '@/components/ui/cx';

const dateFormatter = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

function formatDate(value: string | null) {
  return value ? dateFormatter.format(new Date(value)) : 'Todavía no';
}

function badgeTone(status: GoogleWorkspaceStatus): BadgeTone {
  if (!status.configured) return 'warning';
  if (status.connection.status === 'connected') return 'success';
  if (status.connection.status === 'error') return 'danger';
  return 'neutral';
}

export function GoogleWorkspaceCard() {
  if (IS_DEMO_MODE) {
    return (
      <GoogleCardFrame badge={<Badge tone="neutral">Modo demostración</Badge>}>
        <p className="rounded-lg bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
          La conexión con Google Workspace solo está disponible en la versión conectada al servidor.
        </p>
      </GoogleCardFrame>
    );
  }
  return <LiveGoogleWorkspaceCard />;
}

function LiveGoogleWorkspaceCard() {
  const { state, reload, notice, dismissNotice, actionError, busy, connect, verify, disconnect } =
    useGoogleWorkspace();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (state.status === 'loading') {
    return (
      <GoogleCardFrame>
        <StatusMessage tone="loading" title="Cargando el estado de Google Workspace" />
      </GoogleCardFrame>
    );
  }

  if (state.status === 'error') {
    return (
      <GoogleCardFrame>
        <StatusMessage
          tone="error"
          title="No se pudo cargar la conexión con Google"
          description={state.message}
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Reintentar
            </Button>
          }
        />
      </GoogleCardFrame>
    );
  }

  const status = state.data;
  const connected = status.connection.status === 'connected';

  return (
    <GoogleCardFrame badge={<Badge tone={badgeTone(status)}>{googleStatusLabel(status)}</Badge>}>
      {!status.configured ? (
        <PendingConfiguration status={status} />
      ) : (
        <ConnectionDetails connection={status.connection} mailbox={status.mailbox} />
      )}

      {notice ? <NoticeBanner notice={notice} onDismiss={dismissNotice} /> : null}
      {actionError ? (
        <StatusMessage
          tone="error"
          title="No se pudo completar la acción"
          description={actionError}
        />
      ) : null}

      {status.configured ? (
        <div className="flex flex-wrap gap-2">
          {connected ? (
            <>
              <Button variant="secondary" size="sm" onClick={verify} disabled={busy !== null}>
                <RefreshCw size={16} aria-hidden="true" />
                {busy === 'verify' ? 'Verificando…' : 'Verificar conexión'}
              </Button>
              <Button variant="secondary" size="sm" onClick={connect} disabled={busy !== null}>
                {busy === 'start' ? 'Redirigiendo…' : 'Reconectar'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={busy !== null}
              >
                <Unplug size={16} aria-hidden="true" />
                Desconectar
              </Button>
            </>
          ) : (
            <Button variant="primary" size="md" onClick={connect} disabled={busy !== null}>
              <ShieldCheck size={18} aria-hidden="true" />
              {busy === 'start'
                ? 'Redirigiendo a Google…'
                : status.connection.status === 'error'
                  ? 'Reconectar Google Workspace'
                  : 'Conectar Google Workspace'}
            </Button>
          )}
        </div>
      ) : null}

      <Dialog
        open={confirmOpen}
        title="Desconectar Google Workspace"
        description="Se eliminará el acceso guardado en el servidor y se pedirá a Google que lo revoque."
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={busy !== null}
              onClick={async () => {
                setConfirmOpen(false);
                await disconnect();
              }}
            >
              Desconectar cuenta
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-600">
          Podrás volver a conectar el buzón en cualquier momento.
        </p>
      </Dialog>
    </GoogleCardFrame>
  );
}

function GoogleCardFrame({ badge, children }: { badge?: ReactNode; children?: ReactNode }) {
  return (
    <Panel as="article" className="flex flex-col gap-5 p-6">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-plw-ivory text-plw-gold">
          <Mail size={20} aria-hidden="true" />
        </span>
        {badge}
      </div>
      <div>
        <h2 className="text-base font-semibold text-plw-ink">Google Workspace</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Conexión del buzón compartido de correo. La recepción y el envío de mensajes se activarán
          en la siguiente etapa.
        </p>
      </div>
      <dl className="rounded-lg bg-neutral-50 px-4 py-3">
        <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">Buzón</dt>
        <dd className="mt-1 break-all text-sm font-medium text-plw-ink">
          {GOOGLE_MAILBOX_ADDRESS}
        </dd>
      </dl>
      {children}
    </Panel>
  );
}

function PendingConfiguration({ status }: { status: GoogleWorkspaceStatus }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-warning-100 bg-warning-50 p-4">
      <p className="text-sm font-medium text-warning-700">
        Falta configurar el acceso a Google en el servidor.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-warning-700">
        {status.missing.map((name) => (
          <li key={name}>
            <code className="font-mono text-xs">{name}</code>
          </li>
        ))}
      </ul>
      <p className="text-sm text-neutral-700">
        En Google Cloud, registra esta dirección de redirección en el cliente OAuth:
      </p>
      <code className="break-all rounded-md bg-white px-3 py-2 font-mono text-xs text-plw-ink ring-1 ring-neutral-200">
        {status.callbackUrl}
      </code>
      <p className="text-xs text-neutral-600">
        Los valores se guardan como secretos del servidor y nunca se muestran en esta pantalla.
      </p>
    </div>
  );
}

function ConnectionDetails({
  connection,
  mailbox,
}: {
  connection: GoogleConnection;
  mailbox: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-3 sm:grid-cols-2">
        <DetailItem label="Cuenta autorizada" value={connection.connectedAccount ?? 'Ninguna'} />
        <DetailItem label="Buzón" value={mailbox} />
        <DetailItem label="Conectada el" value={formatDate(connection.connectedAt)} />
        <DetailItem
          label="Última verificación exitosa"
          value={formatDate(connection.lastVerifiedAt)}
        />
        <DetailItem
          label="Permiso de lectura de Gmail"
          value={connection.permissions.gmailRead ? 'Concedido' : 'Falta concederlo'}
        />
        <DetailItem
          label="Permiso de envío de Gmail"
          value={connection.permissions.gmailSend ? 'Concedido' : 'Falta concederlo'}
        />
      </dl>
      {connection.status === 'error' && connection.lastError ? (
        <StatusMessage
          tone="error"
          title="La conexión necesita atención"
          description={connection.lastError}
        />
      ) : null}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-1 break-all text-sm text-plw-ink">{value}</dd>
    </div>
  );
}

function NoticeBanner({ notice, onDismiss }: { notice: GoogleNotice; onDismiss: () => void }) {
  return (
    <div
      role="status"
      className={cx(
        'flex items-start justify-between gap-3 rounded-lg px-4 py-3 text-sm ring-1 ring-inset',
        notice.tone === 'success'
          ? 'bg-success-50 text-success-700 ring-success-100'
          : 'bg-danger-50 text-danger-700 ring-danger-100'
      )}
    >
      <span>{notice.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 font-medium underline-offset-2 hover:underline"
      >
        Cerrar
      </button>
    </div>
  );
}
