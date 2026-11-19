import { useEffect, useState, type FormEvent } from 'react';
import { Globe, ExternalLink, Mail, MessageCircle, Check, ChevronDown } from 'lucide-react';
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
  DRAFT_ROW_COLUMNS,
  type ProspectSiteDraft,
  type SiteDraftFact,
  type SiteDraftFaq,
  type SiteDraftImage,
} from '../models/siteDraft';
import { BusinessImagesSection } from './BusinessImagesSection';

const FIELD =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-normal text-plw-ink focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30';
const LOAD_ERROR = 'No se pudo cargar la muestra. Verifique su conexión e intente de nuevo.';

interface SiteDraftCardProps {
  prospect: Prospect;
  /** The signed-in agent; the administrator opens the same card read-write for verification. */
  canEdit: boolean;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
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
  // Quick create starts blank on purpose: these exist only if the agent types them.
  const [services, setServices] = useState('');
  const [highlight, setHighlight] = useState('');
  const [bookingPhone, setBookingPhone] = useState('');
  const [phoneConfirmed, setPhoneConfirmed] = useState(false);
  const [description, setDescription] = useState('');
  const [facts, setFacts] = useState<SiteDraftFact[]>([]);
  const [faqs, setFaqs] = useState<SiteDraftFaq[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set right after the agent opens a composer; only the explicit confirm button records sharing.
  const [sharePrompt, setSharePrompt] = useState<'email' | 'whatsapp' | null>(null);
  const [images, setImages] = useState<SiteDraftImage[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => {
      setPhase({ kind: 'loading' });
      supabase
        .from('prospect_site_drafts')
        .select(DRAFT_ROW_COLUMNS)
        .eq('prospect_id', prospect.id)
        .maybeSingle()
        .then(
          ({ data, error: loadError }) => {
            if (!alive) return;
            if (loadError) {
              setPhase({ kind: 'error', message: loadError.message || LOAD_ERROR });
              return;
            }
            if (!data) {
              setPhase({ kind: 'form' });
              return;
            }
            const draft = draftFromRow(data);
            hydrate(draft);
            setPhase({ kind: 'saved', draft });
          },
          () => alive && setPhase({ kind: 'error', message: LOAD_ERROR })
        );
    };
    load();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, prospect.id, reloadKey]);
  const retryLoad = () => setReloadKey((key) => key + 1);

  function hydrate(draft: ProspectSiteDraft) {
    setCategory(draft.category);
    setBusinessName(draft.businessName);
    setLocale(draft.locale);
    setServices(draft.services.join(', '));
    setHighlight(draft.highlight);
    setBookingPhone(draft.bookingPhone);
    setPhoneConfirmed(draft.bookingPhone.trim() !== '');
    setDescription(draft.description);
    setFacts(draft.facts);
    setFaqs(draft.faqs);
    setImages(draft.approvedImages);
  }

  if (phase.kind === 'loading') {
    return (
      <section aria-label="Muestra de sitio web" className="rounded-xl border border-plw-gold/50 bg-white p-4">
        <div className="flex items-center gap-3">
          <Globe size={18} className="text-plw-navy" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-plw-ink">Muestra de sitio web</h3>
          <span className="ml-auto text-xs text-neutral-500">Cargando…</span>
        </div>
      </section>
    );
  }
  if (phase.kind === 'error') {
    return (
      <section aria-label="Muestra de sitio web" className="rounded-xl border border-plw-gold/50 bg-white p-4">
        <div className="flex items-center gap-3">
          <Globe size={18} className="text-plw-navy" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-plw-ink">Muestra de sitio web</h3>
        </div>
        <div className="mt-3 grid gap-2">
          <StatusMessage tone="error" title={phase.message} />
          <Button size="sm" variant="secondary" className="justify-self-start" onClick={retryLoad}>
            Intentar de nuevo
          </Button>
        </div>
      </section>
    );
  }

  const draft = phase.kind === 'saved' ? phase.draft : null;

  async function save(event: FormEvent) {
    event.preventDefault();
    const typedPhone = bookingPhone.trim();
    if (typedPhone !== '' && !phoneConfirmed) {
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
        p_booking_phone: typedPhone,
        p_description: description.trim(),
        p_facts: facts
          .map((fact) => ({ label: fact.label.trim(), value: fact.value.trim() }))
          .filter((fact) => fact.label !== '' && fact.value !== '')
          .slice(0, 12),
        p_faqs: faqs
          .map((faq) => ({ question: faq.question.trim(), answer: faq.answer.trim() }))
          .filter((faq) => faq.question !== '' && faq.answer !== '')
          .slice(0, 12),
      });
      if (rpcError || typeof draftId !== 'string') {
        throw new Error(rpcError?.message || 'No se pudo guardar el borrador.');
      }
      const { data, error: readError } = await supabase
        .from('prospect_site_drafts')
        .select(DRAFT_ROW_COLUMNS)
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
    // supabase.rpc reports failures in `error` instead of throwing, so check it explicitly:
    // the card must not claim "compartido" when the server refused.
    const { data: sharedAt, error: shareError } = await supabase.rpc('mark_prospect_site_shared', {
      p_prospect_id: prospect.id,
      p_channel: channel,
    });
    if (shareError) {
      setError(shareError.message || 'No se pudo marcar como compartido.');
      return;
    }
    setSharePrompt(null);
    setPhase({
      kind: 'saved',
      draft: { ...draft, sharedAt: typeof sharedAt === 'string' ? sharedAt : new Date().toISOString() },
    });
  }

  const openComposer = (channel: 'email' | 'whatsapp') => {
    if (!draft) return;
    const text = `Le preparé una muestra del sitio web de ${draft.businessName}: ${draft.previewUrl}`;
    if (channel === 'email' && prospect.email) {
      window.location.href = `mailto:${prospect.email}?subject=${encodeURIComponent(
        `Muestra del sitio web de ${draft.businessName}`
      )}&body=${encodeURIComponent(text)}`;
    } else {
      // wa.me needs the country code: Costa Rica numbers are often stored as 8 digits.
      const digits = prospect.phone.replace(/[^0-9]/g, '');
      window.open(
        `https://wa.me/${digits.length === 8 ? `506${digits}` : digits}?text=${encodeURIComponent(text)}`,
        '_blank',
        'noopener'
      );
    }
    setSharePrompt(channel);
  };

  const updateFact = (index: number, patch: Partial<SiteDraftFact>) => {
    setFacts((current) => current.map((fact, i) => (i === index ? { ...fact, ...patch } : fact)));
  };
  const updateFaq = (index: number, patch: Partial<SiteDraftFaq>) => {
    setFaqs((current) => current.map((faq, i) => (i === index ? { ...faq, ...patch } : faq)));
  };

  async function applyImagesWith(next: SiteDraftImage[]) {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('set_prospect_site_approved_images', {
        p_prospect_id: prospect.id,
        p_images: next.slice(0, 4),
      });
      if (rpcError) throw new Error(rpcError.message || 'No se pudieron guardar las imágenes.');
      const saved = Array.isArray(data) ? (data as SiteDraftImage[]) : [];
      setImages(saved);
      setPhase({ kind: 'saved', draft: { ...draft, approvedImages: saved } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron guardar las imágenes.');
      throw cause instanceof Error ? cause : new Error('No se pudieron guardar las imágenes.');
    } finally {
      setSaving(false);
    }
  }

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
          {sharePrompt && canEdit && !draft.sharedAt ? (
            <div className="grid gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
              <span className="text-neutral-700">
                ¿Ya envió el enlace por {sharePrompt === 'email' ? 'correo' : 'WhatsApp'}?
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void markShared(sharePrompt)}
                >
                  <Check size={14} aria-hidden="true" />
                  Marcar como compartido
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSharePrompt(null)}
                >
                  Todavía no
                </Button>
              </div>
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
                onChange={(event) => setCategory(event.target.value as 'tours' | 'lodging')}
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
              label="Teléfono público de reservas (opcional)"
              type="tel"
              value={bookingPhone}
              maxLength={20}
              hint="Escríbelo solo si el cliente quiere que aparezca en su página."
              onChange={(event) => setBookingPhone(event.target.value)}
            />
            <label className="flex items-start gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={phoneConfirmed}
                onChange={(event) => setPhoneConfirmed(event.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              Si escribiste un teléfono: el cliente confirmó que puede aparecer en su página
              pública.
            </label>

            <details className="rounded-lg border border-neutral-200 bg-neutral-50/60">
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-plw-navy">
                <ChevronDown size={14} aria-hidden="true" />
                Mejorar la muestra (opcional)
              </summary>
              <div className="grid gap-4 border-t border-neutral-200 px-3 py-3">
                <p className="text-xs text-neutral-500">
                  Agregue detalles solo con las palabras del dueño, verificadas con él o con una
                  fuente pública que usted abra y confirme. Nada se toma del expediente interno.
                </p>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-neutral-700">Descripción pública</span>
                  <textarea
                    value={description}
                    maxLength={2000}
                    rows={4}
                    placeholder="Ej.: Tours en lancha por el Río Frío con guías locales."
                    onChange={(event) => setDescription(event.target.value)}
                    className={FIELD}
                  />
                </label>

                <div className="grid gap-2">
                  <span className="font-medium text-neutral-700">Datos del negocio</span>
                  {facts.map((fact, index) => (
                    <div key={index} className="flex flex-wrap items-center gap-2">
                      <input
                        value={fact.label}
                        maxLength={120}
                        placeholder="Dato (ej. Horario)"
                        aria-label={`Dato ${index + 1}`}
                        onChange={(event) => updateFact(index, { label: event.target.value })}
                        className={`${FIELD} w-40 flex-none sm:w-48`}
                      />
                      <input
                        value={fact.value}
                        maxLength={600}
                        placeholder="Valor (ej. Lunes a sábado, 8 am–5 pm)"
                        aria-label={`Valor del dato ${index + 1}`}
                        onChange={(event) => updateFact(index, { value: event.target.value })}
                        className={`${FIELD} min-w-0 flex-1`}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        aria-label={`Quitar dato ${index + 1}`}
                        onClick={() => setFacts((current) => current.filter((_, i) => i !== index))}
                      >
                        Quitar
                      </Button>
                    </div>
                  ))}
                  {facts.length < 12 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="justify-self-start"
                      onClick={() => setFacts((current) => [...current, { label: '', value: '' }])}
                    >
                      Agregar dato
                    </Button>
                  ) : null}
                </div>

                <div className="grid gap-2">
                  <span className="font-medium text-neutral-700">Preguntas frecuentes</span>
                  {faqs.map((faq, index) => (
                    <div key={index} className="grid gap-2 rounded-lg border border-neutral-200 p-2">
                      <input
                        value={faq.question}
                        maxLength={300}
                        placeholder="Pregunta (ej. ¿Incluye el almuerzo?)"
                        aria-label={`Pregunta frecuente ${index + 1}`}
                        onChange={(event) => updateFaq(index, { question: event.target.value })}
                        className={FIELD}
                      />
                      <textarea
                        value={faq.answer}
                        maxLength={2000}
                        rows={2}
                        placeholder="Respuesta"
                        aria-label={`Respuesta frecuente ${index + 1}`}
                        onChange={(event) => updateFaq(index, { answer: event.target.value })}
                        className={FIELD}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="justify-self-start"
                        aria-label={`Quitar pregunta frecuente ${index + 1}`}
                        onClick={() => setFaqs((current) => current.filter((_, i) => i !== index))}
                      >
                        Quitar
                      </Button>
                    </div>
                  ))}
                  {faqs.length < 12 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="justify-self-start"
                      onClick={() =>
                        setFaqs((current) => [...current, { question: '', answer: '' }])
                      }
                    >
                      Agregar pregunta
                    </Button>
                  ) : null}
                </div>

                {businessName.trim() ? (
                  <BusinessImagesSection
                    prospectId={prospect.id}
                    businessName={businessName.trim()}
                    locale={locale.trim()}
                    approvedImages={images}
                    onApplyApproved={async (next) => {
                      await applyImagesWith(next);
                    }}
                  />
                ) : null}
              </div>
            </details>

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
