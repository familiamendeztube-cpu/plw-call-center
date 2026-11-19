import { useEffect, useState, type FormEvent } from 'react';
import { Globe, ExternalLink, Mail, MessageCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/TextField';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { CopyButton } from '@/components/ui/CopyButton';
import type { Prospect } from '@/features/leads/models/prospect';
import { getSupabaseClient } from '@/integrations/supabase/client';
import {
  SITE_SLUGS,
  buildPreviewUrl,
  draftFromRow,
  suggestServices,
  type ProspectSiteDraft,
} from '../models/siteDraft';

const FIELD =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-normal text-plw-ink focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30';

interface SiteDraftCardProps {
  prospect: Prospect;
  /** The signed-in agent; the administrator opens the same card read-write for verification. */
  canEdit: boolean;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'form' }
  | { kind: 'saved'; draft: ProspectSiteDraft };

/**
 * "Crear muestra web": one sample-site draft per prospect with a preview link. Draft only:
 * nothing sends automatically, and the destination is confirmed in the composer the agent opens.
 */
export function SiteDraftCard({ prospect, canEdit }: SiteDraftCardProps) {
  const supabase = getSupabaseClient();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [open, setOpen] = useState(false);

  const businessCategory = prospect.businessCategory.toLowerCase();
  const defaultCategory: 'tours' | 'lodging' = businessCategory.includes('hosped')
    ? 'lodging'
    : 'tours';

  const [category, setCategory] = useState<'tours' | 'lodging'>(defaultCategory);
  const [businessName, setBusinessName] = useState(prospect.businessName);
  const [locale, setLocale] = useState('');
  const [services, setServices] = useState(suggestServices(defaultCategory, prospect.serviceInterest).join(', '));
  const [highlight, setHighlight] = useState('');
  const [bookingPhone, setBookingPhone] = useState('');
  const [phoneConfirmed, setPhoneConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    supabase
      .from('prospect_site_drafts')
      .select(
        'prospect_id, site_slug, business_name, locale, category, services, highlight, booking_phone, preview_token, shared_at'
      )
      .eq('prospect_id', prospect.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        setPhase(data ? { kind: 'saved', draft: draftFromRow(data) } : { kind: 'form' });
      })
      .catch(() => alive && setPhase({ kind: 'form' }));
    return () => {
      alive = false;
    };
  }, [supabase, prospect.id]);

  if (phase.kind === 'loading') return null;

  const draft = phase.kind === 'saved' ? phase.draft : null;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!phoneConfirmed) {
      setError('Confirma que el cliente aprobó publicar ese teléfono en su página.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data: draftId, error: rpcError } = await supabase.rpc('upsert_prospect_site_draft', {
        p_prospect_id: prospect.id,
        p_site_slug: category === 'tours' ? SITE_SLUGS.tours : SITE_SLUGS.lodging,
        p_business_name: businessName.trim(),
        p_locale: locale.trim(),
        p_category: category,
        p_services: services
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 12),
        p_highlight: highlight.trim(),
        p_booking_phone: bookingPhone.trim(),
      });
      if (rpcError || typeof draftId !== 'string') {
        throw new Error(rpcError?.message || 'No se pudo guardar el borrador.');
      }
      const { data, error: readError } = await supabase
        .from('prospect_site_drafts')
        .select(
          'prospect_id, site_slug, business_name, locale, category, services, highlight, booking_phone, preview_token, shared_at'
        )
        .eq('id', draftId)
        .maybeSingle();
      if (readError || !data) throw new Error('No se pudo guardar el borrador.');
      const saved = draftFromRow(data);
      setPhase({ kind: 'saved', draft: saved });
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el borrador.');
    } finally {
      setSaving(false);
    }
  }

  async function markShared(channel: 'email' | 'whatsapp') {
    if (!draft) return;
    try {
      await supabase.rpc('mark_prospect_site_shared', {
        p_prospect_id: prospect.id,
        p_channel: channel,
      });
      setPhase({ kind: 'saved', draft: { ...draft, sharedAt: new Date().toISOString() } });
    } catch {
      // Sharing status is a note, not a promise: a failure leaves the draft itself intact.
    }
  }

  const openComposer = (channel: 'email' | 'whatsapp') => {
    if (!draft) return;
    const text = `Le preparé una muestra del sitio web de ${draft.businessName}: ${draft.previewUrl}`;
    if (channel === 'email' && prospect.email) {
      window.location.href = `mailto:${prospect.email}?subject=${encodeURIComponent(
        `Muestra del sitio web de ${draft.businessName}`
      )}&body=${encodeURIComponent(text)}`;
    } else {
      window.open(
        `https://wa.me/${prospect.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(text)}`,
        '_blank',
        'noopener'
      );
    }
    void markShared(channel);
  };

  return (
    <section
      aria-label="Muestra de sitio web"
      className="rounded-xl border border-plw-gold/50 bg-white p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Globe size={18} className="text-plw-navy" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-plw-ink">Muestra de sitio web</h3>
        {draft ? (
          <span className="rounded-full bg-plw-gold-soft/40 px-2 py-0.5 text-xs font-medium text-plw-navy">
            Borrador listo
          </span>
        ) : null}
        {canEdit ? (
          <Button
            size="sm"
            variant="primary"
            className="ml-auto"
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
          >
            {draft ? 'Ver muestra web' : 'Crear muestra web'}
          </Button>
        ) : null}
      </div>

      {draft ? (
        <div className="mt-3 grid gap-2 text-sm">
          <p className="break-all text-plw-ink">
            <a
              href={draft.previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-plw-navy underline underline-offset-4"
            >
              Abrir vista previa
              <ExternalLink size={13} aria-hidden="true" />
            </a>
            <CopyButton value={draft.previewUrl} label="Copiar el enlace de vista previa" />
          </p>
          <p className="text-xs text-neutral-500">
            Borrador. Nada se publica ni se envía solo: usted decide por dónde lo comparte y marca
            cuándo lo hizo.
          </p>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => openComposer('whatsapp')}>
                <MessageCircle size={14} aria-hidden="true" />
                Compartir por WhatsApp
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => openComposer('email')}
                disabled={!prospect.email}
              >
                <Mail size={14} aria-hidden="true" />
                Redactar correo
              </Button>
            </div>
          ) : null}
          {draft.sharedAt ? (
            <p className="text-xs text-neutral-500">
              <Check size={12} className="inline" aria-hidden="true" /> Marcado como compartido.
            </p>
          ) : null}
        </div>
      ) : null}

      {open && canEdit ? (
        <Dialog
          open
          title={draft ? 'Editar muestra web' : 'Crear muestra web'}
          description="Solo lo público: nada de las conversaciones ni notas privadas aparece en la página."
          onClose={() => setOpen(false)}
          widthClass="max-w-2xl"
        >
          <form onSubmit={(event) => void save(event)} className="grid gap-4">
            <TextField
              label="Nombre del negocio"
              value={businessName}
              maxLength={120}
              required
              onChange={(event) => setBusinessName(event.target.value)}
            />
            <TextField
              label="Lugar (cantón, provincia)"
              value={locale}
              maxLength={120}
              onChange={(event) => setLocale(event.target.value)}
            />
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-neutral-700">Tipo</span>
              <select
                value={category}
                onChange={(event) => {
                  const next = event.target.value as 'tours' | 'lodging';
                  setCategory(next);
                  setServices(suggestServices(next, prospect.serviceInterest).join(', '));
                }}
                className={FIELD}
              >
                <option value="tours">Tours</option>
                <option value="lodging">Hospedaje</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-neutral-700">Servicios (separados por coma)</span>
              <textarea
                value={services}
                maxLength={600}
                rows={3}
                onChange={(event) => setServices(event.target.value)}
                className={FIELD}
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-neutral-700">Lo que quiere destacar (opcional)</span>
              <textarea
                value={highlight}
                maxLength={400}
                rows={2}
                onChange={(event) => setHighlight(event.target.value)}
                className={FIELD}
              />
            </label>
            <TextField
              label="Teléfono público de reservas"
              type="tel"
              value={bookingPhone}
              maxLength={20}
              required
              hint="El cliente debe confirmar este número antes de publicarlo."
              onChange={(event) => setBookingPhone(event.target.value)}
            />
            <label className="flex items-start gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={phoneConfirmed}
                onChange={(event) => setPhoneConfirmed(event.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              El cliente confirmó que este número puede aparecer en su página pública.
            </label>
            {error ? (
              <p role="alert" className="text-sm text-danger-700">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Guardando…' : draft ? 'Actualizar borrador' : 'Crear borrador'}
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {error && !open ? (
        <StatusMessage tone="error" title={error} />
      ) : null}
    </section>
  );
}

export const PREVIEW_BASE_HELP = buildPreviewUrl('<token>');
