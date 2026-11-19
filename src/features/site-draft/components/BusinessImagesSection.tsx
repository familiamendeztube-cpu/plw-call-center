import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type ChangeEvent } from 'react';
import { ImagePlus, Loader2, MapPin, RefreshCw, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { getSupabaseClient } from '@/integrations/supabase/client';
import { buildMapsSearchUrl, type SiteDraftImage } from '../models/siteDraft';

const FIELD =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-normal text-plw-ink focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30';
const MAX_BYTES = 5 * 1024 * 1024;
const CR_PHONE = /^(?:\+506)?[\s-]?\d{4}[\s-]?\d{4}$/;

export interface CandidateImage {
  id: string;
  kind: 'business' | 'generated';
  authorized: boolean;
  alt: string;
  thumbnailUrl: string | null;
}

interface BusinessImagesSectionProps {
  prospectId: string;
  businessName: string;
  locale: string;
  approvedImages: SiteDraftImage[];
  onApplyApproved: (images: SiteDraftImage[]) => Promise<void>;
}

type InvokeResult = { candidate?: CandidateImage; url?: string; error?: string; generationAvailable?: boolean };

/** "Imágenes del negocio": import/paste/generate candidates, review privately, approve to the draft. */
export function BusinessImagesSection({
  prospectId,
  businessName,
  locale,
  approvedImages,
  onApplyApproved,
}: BusinessImagesSectionProps) {
  const supabase = getSupabaseClient();
  const [candidates, setCandidates] = useState<CandidateImage[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [alts, setAlts] = useState<Record<string, string>>({});
  const [kinds, setKinds] = useState<Record<string, 'business' | 'generated'>>({});
  const [sourcePhone, setSourcePhone] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [genAvailable, setGenAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<'upload' | 'generate' | 'approve' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    supabase.functions
      .invoke<InvokeResult>('plw-site-images', { body: { action: 'status', prospectId } })
      .then(({ data }) => alive && setGenAvailable(data?.generationAvailable === true))
      .catch(() => alive && setGenAvailable(false));
    return () => {
      alive = false;
    };
  }, [supabase, prospectId]);

  const call = useCallback(
    async (body: Record<string, unknown>): Promise<InvokeResult> => {
      const { data, error } = await supabase.functions.invoke<InvokeResult>('plw-site-images', {
        body: { prospectId, ...body },
      });
      if (error) throw new Error(error.message || 'No se pudo completar la acción.');
      if (data?.error) throw new Error(data.error);
      return data ?? {};
    },
    [supabase, prospectId]
  );

  const importBytes = useCallback(
    async (bytes: Uint8Array) => {
      if (bytes.byteLength > MAX_BYTES) {
        setNote('La imagen debe pesar menos de 5 MB.');
        return;
      }
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      setBusy('upload');
      setNote(null);
      try {
        const { candidate } = await call({ action: 'upload', imageBase64: btoa(binary) });
        if (candidate) {
          setCandidates((current) => [candidate, ...current]);
          setAlts((current) => ({ ...current, [candidate.id]: '' }));
          setKinds((current) => ({ ...current, [candidate.id]: candidate.kind }));
        }
      } catch (cause) {
        setNote(cause instanceof Error ? cause.message : 'No se pudo importar la imagen.');
      } finally {
        setBusy(null);
      }
    },
    [call]
  );

  const onFilePicked = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void file.arrayBuffer().then((buffer) => importBytes(new Uint8Array(buffer)));
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const file = Array.from(event.clipboardData.items).find((item) => item.type.startsWith('image/'))?.getAsFile();
    if (file) {
      event.preventDefault();
      void file.arrayBuffer().then((buffer) => importBytes(new Uint8Array(buffer)));
    }
  };

  const generate = async () => {
    setBusy('generate');
    setNote(null);
    try {
      const prompt = `Ilustración contextual para el negocio ${businessName}${locale ? ` en ${locale}` : ''}, estilo limpio, sin texto.`;
      const { candidate } = await call({ action: 'generate', prompt });
      if (candidate) {
        setCandidates((current) => [candidate, ...current]);
        setAlts((current) => ({ ...current, [candidate.id]: '' }));
        setKinds((current) => ({ ...current, [candidate.id]: 'generated' }));
      }
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : 'No se pudo generar la imagen.');
    } finally {
      setBusy(null);
    }
  };

  const approveSelected = async () => {
    const chosen = candidates.filter((candidate) => selected.has(candidate.id));
    if (chosen.length === 0) return;
    setBusy('approve');
    setNote(null);
    try {
      const approved: SiteDraftImage[] = [...approvedImages];
      for (const candidate of chosen) {
        const alt = (alts[candidate.id] ?? '').trim() || `Imagen de ${businessName}`;
        const kind = kinds[candidate.id] ?? candidate.kind;
        const { url } = await call({ action: 'approve', candidateId: candidate.id, alt, kind });
        if (url) approved.push({ url, alt, kind });
      }
      await onApplyApproved(approved.slice(0, 4));
      setSelected(new Set());
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : 'No se pudieron usar las imágenes.');
    } finally {
      setBusy(null);
    }
  };

  const validPhone = CR_PHONE.test(sourcePhone.trim());
  const validUrl = /^https:\/\/[^\s]{4,300}$/.test(sourceUrl.trim()) && !sourceUrl.includes('..');
  const mapsUrl = buildMapsSearchUrl(businessName, locale);

  return (
    <div
      className="grid gap-3 rounded-lg border border-neutral-200 bg-white p-3"
      onPaste={onPaste}
      tabIndex={0}
      aria-label="Imágenes del negocio"
    >
      <span className="text-sm font-medium text-plw-navy">Imágenes del negocio</span>
      <p className="text-xs text-neutral-500">
        <MapPin size={12} className="inline" aria-hidden="true" /> Importe fotos autorizadas por el
        dueño o pegue una captura. Las miniaturas son privadas hasta que las seleccione y use
        "Usar imágenes seleccionadas".
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <TextField
          label="Teléfono del negocio (fuente, opcional)"
          type="tel"
          value={sourcePhone}
          maxLength={20}
          placeholder="+506 8888-7777"
          hint={sourcePhone.trim() === '' || validPhone ? 'Costa Rica: +506 y 8 dígitos.' : 'Formato no reconocido.'}
          onChange={(event) => setSourcePhone(event.target.value)}
        />
        <TextField
          label="Sitio web o enlace de Google Maps (fuente, opcional)"
          type="url"
          value={sourceUrl}
          maxLength={300}
          placeholder="https://..."
          onChange={(event) => setSourceUrl(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-plw-navy underline underline-offset-4"
        >
          Abrir Google Maps
        </a>
        {validUrl ? (
          <a
            href={sourceUrl.trim()}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-plw-navy underline underline-offset-4"
          >
            Abrir el sitio indicado
          </a>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => fileInput.current?.click()}
        >
          {busy === 'upload' ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <ImagePlus size={14} aria-hidden="true" />
          )}
          Importar imagen
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          aria-label="Elegir imagen del negocio"
          onChange={onFilePicked}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy !== null || genAvailable === false}
          onClick={() => void generate()}
          title={
            genAvailable === false
              ? 'La generación de ilustraciones no está configurada.'
              : 'Generar una ilustración AI'
          }
        >
          {busy === 'generate' ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <Wand2 size={14} aria-hidden="true" />
          )}
          {genAvailable === false ? 'Generación no configurada' : 'Generar ilustración AI'}
        </Button>
        <span className="self-center text-xs text-neutral-500">
          También puede pegar una imagen con Ctrl+V.
        </span>
      </div>

      {candidates.length > 0 ? (
        <div className="grid gap-2">
          {candidates.map((candidate) => (
            <div key={candidate.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 p-2">
              <input
                type="checkbox"
                checked={selected.has(candidate.id)}
                aria-label={`Seleccionar imagen ${candidate.id}`}
                onChange={(event) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(candidate.id);
                    else next.delete(candidate.id);
                    return next;
                  })
                }
                className="h-4 w-4"
              />
              {candidate.thumbnailUrl ? (
                <img
                  src={candidate.thumbnailUrl}
                  alt={alts[candidate.id] || 'Miniatura privada'}
                  className="h-14 w-20 rounded-md object-cover"
                />
              ) : (
                <div className="grid h-14 w-20 place-items-center rounded-md bg-neutral-100 text-xs text-neutral-400">
                  <RefreshCw size={14} aria-hidden="true" />
                </div>
              )}
              <select
                value={kinds[candidate.id] ?? candidate.kind}
                aria-label={`Tipo de imagen ${candidate.id}`}
                onChange={(event) =>
                  setKinds((current) => ({
                    ...current,
                    [candidate.id]: event.target.value as 'business' | 'generated',
                  }))
                }
                className={`${FIELD} w-44`}
              >
                <option value="business">Foto del negocio (autorizada)</option>
                <option value="generated">Ilustración AI</option>
              </select>
              <input
                value={alts[candidate.id] ?? ''}
                maxLength={200}
                placeholder="Descripción (ej. Cabaña frente al río)"
                aria-label={`Descripción de imagen ${candidate.id}`}
                onChange={(event) =>
                  setAlts((current) => ({ ...current, [candidate.id]: event.target.value }))
                }
                className={`${FIELD} min-w-0 flex-1`}
              />
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="primary"
            className="justify-self-start"
            disabled={busy !== null || selected.size === 0}
            onClick={() => void approveSelected()}
          >
            {busy === 'approve' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
            Usar imágenes seleccionadas
          </Button>
        </div>
      ) : null}

      {approvedImages.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {approvedImages.map((image) => (
            <img
              key={image.url}
              src={image.url}
              alt={image.alt}
              className="h-16 w-24 rounded-md object-cover"
            />
          ))}
          <span className="self-center text-xs text-neutral-500">
            Imágenes aprobadas que ya aparecen en la muestra.
          </span>
        </div>
      ) : null}

      {note ? (
        <p role="alert" className="text-sm text-danger-700">
          {note}
        </p>
      ) : null}
    </div>
  );
}
