import { useEffect, useState, type FormEvent } from 'react';
import { Bot, Check, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { getSupabaseClient } from '@/integrations/supabase/client';
import {
  SITE_PREVIEW_BASE,
  DRAFT_ROW_COLUMNS,
  draftFromRow,
  type ProspectSiteDraft,
} from '../models/siteDraft';

const FIELD =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-normal text-plw-ink focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30';
const PHONE = /^\+?506\s?\d{4}\s?\d{4}$/;
const LOAD_ERROR = 'No se pudo cargar la secretaria. Intente de nuevo.';

const TYPE_OPTIONS = [
  { value: 'tourism', label: 'Turismo (tours u hospedaje)' },
  { value: 'restaurant', label: 'Restaurante' },
  { value: 'retail', label: 'Tienda / venta al público' },
  { value: 'services', label: 'Servicios generales' },
] as const;

export type SecretaryType = (typeof TYPE_OPTIONS)[number]['value'];

interface SecretarySectionProps {
  prospectId: string;
  /** Known entries prefilled from the customer; the demo never publishes a phone. */
  defaultName: string;
  defaultPhone: string;
  /** Draft category prefills the type until the agent saves a secretary-specific one. */
  defaultType: SecretaryType;
  canEdit: boolean;
}

/**
 * "Secretaria IA": configures the voice sales demo (name, phone, type) beside the
 * website draft, on the same token. Nothing is dialed, sent, or activated — the demo
 * is a passive voice sample the agent shares as a link.
 */
export function SecretarySection({
  prospectId,
  defaultName,
  defaultPhone,
  defaultType,
  canEdit,
}: SecretarySectionProps) {
  const supabase = getSupabaseClient();
  const [draft, setDraft] = useState<ProspectSiteDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState(defaultPhone);
  const [type, setType] = useState<SecretaryType>(defaultType);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    supabase
      .from('prospect_site_drafts')
      .select(DRAFT_ROW_COLUMNS)
      .eq('prospect_id', prospectId)
      .maybeSingle()
      .then(
        ({ data, error: loadError }) => {
          if (!alive) return;
          if (loadError) {
            setLoadError(loadError.message || LOAD_ERROR);
          } else if (data) {
            // Parse through the shared mapper: the raw row is snake_case and carries the
            // preview token; reading camelCase off it left the demo links empty.
            const loaded = draftFromRow(data as Record<string, unknown>);
            setDraft(loaded);
            if (loaded.secretaryName.trim() !== '') {
              setName(loaded.secretaryName);
            }
            const savedType = loaded.secretaryType;
            if (savedType === 'tourism' || savedType === 'restaurant' || savedType === 'retail' || savedType === 'services') {
              setType(savedType);
            }
          }
          setLoading(false);
        },
        () => alive && (setLoadError(LOAD_ERROR), setLoading(false))
      );
    return () => {
      alive = false;
    };
  }, [supabase, prospectId]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const typedPhone = phone.trim();
    if (typedPhone !== '' && !PHONE.test(typedPhone)) {
      setError('El teléfono debe ser de Costa Rica: +506 y 8 dígitos.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('set_prospect_secretary_demo', {
        p_prospect_id: prospectId,
        p_name: name.trim(),
        p_type: type,
      });
      if (rpcError) throw new Error(rpcError.message || 'No se pudo guardar la secretaria.');
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la secretaria.');
    } finally {
      setSaving(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setSaved(true);
    } catch {
      setError('No se pudo copiar el enlace.');
    }
  }

  if (loading) {
    return (
      <section aria-label="Secretaria IA" className="rounded-xl border border-plw-gold/50 bg-white p-4">
        <div className="flex items-center gap-3">
          <Bot size={18} className="text-plw-navy" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-plw-ink">Secretaria IA</h3>
          <span className="ml-auto text-xs text-neutral-500">Cargando…</span>
        </div>
      </section>
    );
  }
  if (loadError) {
    return (
      <section aria-label="Secretaria IA" className="rounded-xl border border-plw-gold/50 bg-white p-4">
        <div className="flex items-center gap-3">
          <Bot size={18} className="text-plw-navy" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-plw-ink">Secretaria IA</h3>
        </div>
        <p role="alert" className="mt-3 text-sm text-danger-700">
          {loadError}
        </p>
      </section>
    );
  }

  // The token comes from the draft (created by this section or by the website card).
  const token = draft?.previewToken ?? '';
  const secretaryUrl = token ? `${SITE_PREVIEW_BASE}/plw-${token}/secretaria` : '';
  const siteUrl = draft?.previewUrl ?? '';

  return (
    <section aria-label="Secretaria IA" className="rounded-xl border border-plw-gold/50 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Bot size={18} className="text-plw-navy" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-plw-ink">Secretaria IA</h3>
        {saved ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-plw-gold-soft/40 px-2 py-0.5 text-xs font-medium text-plw-navy">
            <Check size={12} aria-hidden="true" /> Guardado
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        Demostración de voz de la asistente, con la misma voz de la muestra. No marca llamadas ni
        envía mensajes: es solo un enlace de demostración para compartir.
      </p>

      {canEdit ? (
        <form onSubmit={(event) => void save(event)} className="mt-3 grid gap-3">
          <TextField
            label="Nombre del negocio"
            value={name}
            maxLength={120}
            required
            onChange={(event) => setName(event.target.value)}
          />
          <TextField
            label="Teléfono de la empresa"
            type="tel"
            value={phone}
            maxLength={20}
            hint="Costa Rica: +506 y 8 dígitos. Nunca se publica ni se menciona en la demo."
            onChange={(event) => setPhone(event.target.value)}
          />
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-neutral-700">Tipo de negocio</span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value as SecretaryType)}
              className={FIELD}
            >
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {error ? (
            <p role="alert" className="text-sm text-danger-700">
              {error}
            </p>
          ) : null}
          <div className="justify-self-start">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar secretaria'}
            </Button>
          </div>
        </form>
      ) : error ? (
        <p role="alert" className="mt-3 text-sm text-danger-700">
          {error}
        </p>
      ) : null}

      {secretaryUrl ? (
        <div className="mt-3 grid gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={secretaryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-plw-navy underline underline-offset-4"
            >
              Abrir demo
              <ExternalLink size={13} aria-hidden="true" />
            </a>
            <Button size="sm" variant="secondary" onClick={() => void copy(secretaryUrl)}>
              Copiar enlace
            </Button>
            {siteUrl ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void copy(`${secretaryUrl}\n${siteUrl}`)}
              >
                Copiar ambos enlaces
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-neutral-500">
            Demostración disponible 24/7; no hace reservas reales ni promete nada en nombre del
            negocio.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-neutral-600">
          Aún no hay muestra de sitio web para este cliente, y la secretaria usa el mismo enlace de
          vista previa. Cree la muestra en la pestaña «Muestra de sitio web» y vuelva aquí: los
          enlaces de la demo aparecerán solos.
        </p>
      )}
    </section>
  );
}
