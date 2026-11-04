import { useState, type FormEvent } from 'react';
import { useAsync } from '@/app/useAsync';
import { Button } from '@/components/ui/Button';
import {
  loadWhatsAppTemplates,
  type WhatsAppOutgoing,
} from '@/features/whatsapp/hooks/useWhatsApp';
import {
  previewTemplate,
  suggestTemplateValue,
  type WhatsAppTemplate,
} from '@/features/whatsapp/models/templates';
import type { Prospect } from '@/features/leads/models/prospect';

const FIELD =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-normal text-plw-ink focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30';

const readable = (name: string) => name.replace(/_/g, ' ');

interface TemplateComposerProps {
  prospect: Prospect;
  onSend: (outgoing: WhatsAppOutgoing) => Promise<void>;
}

/** Outside WhatsApp's 24-hour window: send one of the approved templates from Chatwoot. */
export function TemplateComposer({ prospect, onSend }: TemplateComposerProps) {
  const templates = useAsync(() => loadWhatsAppTemplates(prospect.id), [prospect.id]);
  const [index, setIndex] = useState(-1);
  const [values, setValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = templates.state.status === 'ready' ? templates.state.data : [];
  const template: WhatsAppTemplate | undefined = list[index];
  const complete = template?.params.every((param) => values[param]?.trim()) ?? false;

  const choose = (next: number) => {
    const chosen = list[next];
    setIndex(next);
    setValues(
      chosen
        ? Object.fromEntries(
            chosen.params.map((param) => [param, suggestTemplateValue(param, chosen, prospect)])
          )
        : {}
    );
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!template || !complete || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend({ template: { name: template.name, language: template.language, values } });
      choose(-1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo enviar la plantilla.');
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl border border-plw-gold/60 bg-plw-gold-soft/15 p-4"
    >
      <p className="text-sm text-plw-ink">
        Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite
        escribirle con una plantilla aprobada; cuando responda, podrás escribirle libremente.
      </p>
      {templates.state.status === 'loading' ? (
        <p className="text-sm text-neutral-500">Cargando plantillas...</p>
      ) : null}
      {templates.state.status === 'error' ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger-700">
          {templates.state.message}
          <Button variant="secondary" size="sm" onClick={templates.reload}>
            Reintentar
          </Button>
        </div>
      ) : null}
      {templates.state.status === 'ready' && list.length === 0 ? (
        <p className="text-sm text-plw-ink">
          No hay plantillas aprobadas que se puedan enviar desde aquí. Las que llevan imagen o
          botones con datos se envían desde Chatwoot.
        </p>
      ) : null}
      {list.length > 0 ? (
        <>
          <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
            Plantilla
            <select
              value={index}
              onChange={(event) => choose(Number(event.target.value))}
              className={FIELD}
            >
              <option value={-1}>Elige una plantilla</option>
              {list.map((item, position) => (
                <option key={`${item.name}-${item.language}`} value={position}>
                  {readable(item.name)} ({item.language})
                </option>
              ))}
            </select>
          </label>
          {template ? (
            <>
              {template.params.map((param) => (
                <label
                  key={param}
                  className="flex flex-col gap-1 text-sm font-medium text-neutral-700"
                >
                  Dato {readable(param)}
                  <input
                    value={values[param] ?? ''}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [param]: event.target.value }))
                    }
                    maxLength={1024}
                    className={FIELD}
                  />
                </label>
              ))}
              <div>
                <p className="text-xs font-medium text-neutral-500">El cliente recibirá:</p>
                <p className="mt-1 whitespace-pre-line rounded-lg bg-white px-3 py-2 text-sm text-plw-ink">
                  {previewTemplate(template, values)}
                </p>
              </div>
            </>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-danger-700">
              {error} Revisa el chat antes de enviarla otra vez.
            </p>
          ) : null}
          <Button type="submit" className="self-end" disabled={!complete || sending}>
            {sending ? 'Enviando...' : 'Enviar plantilla'}
          </Button>
        </>
      ) : null}
    </form>
  );
}
