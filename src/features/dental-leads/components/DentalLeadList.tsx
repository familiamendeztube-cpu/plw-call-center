import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useTelephony } from '@/features/telephony/context/telephonyContext';
import { DENTAL_STATUS, sourceLabel, type DentalLead } from '../models/dentalLead';
import { DentalLeadEditor } from './DentalLeadEditor';
export function DentalLeadList({
  leads,
  agentNames,
  reload,
  callNotes = {},
}: {
  leads: DentalLead[];
  agentNames: Record<string, string>;
  reload: () => void;
  /** Anna's result per lead id, shown under the clinic's name. */
  callNotes?: Record<string, string>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const { changeDialNumber } = useTelephony();
  return (
    <div className="grid gap-3">
      {notice && (
        <p role="status" className="rounded-lg bg-white p-3 text-sm text-plw-navy">
          {notice}
        </p>
      )}
      {leads.map((lead) => (
        <article
          key={lead.id}
          className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-panel"
        >
          <div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:p-5">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-plw-ink">{lead.business_name}</h2>
                <span className="rounded-full bg-plw-ivory px-2.5 py-1 text-xs text-plw-navy">
                  {DENTAL_STATUS[lead.status]}
                </span>
              </div>
              <p className="text-sm text-neutral-600">
                {[lead.canton, lead.province].filter(Boolean).join(', ') || 'Costa Rica'}
              </p>
              {lead.contact_name && <p className="mt-1 text-sm">{lead.contact_name}</p>}
              {callNotes[lead.id] && (
                <p className="mt-1 text-sm font-semibold text-plw-gold-soft">
                  {callNotes[lead.id]}
                </p>
              )}
              <p className="mt-1 text-sm text-neutral-600">
                Responsable:{' '}
                {lead.owner_staff_id
                  ? agentNames[lead.owner_staff_id] || lead.owner_staff_id
                  : 'Sin asignar'}
              </p>
              {lead.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{lead.notes}</p>}
              <p className="mt-3 text-xs text-neutral-500">
                <a
                  href={lead.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {lead.source_name}
                </a>
                {' · '}
                {sourceLabel(lead.verification)} · Consultado {lead.source_checked_at}
              </p>
            </div>
            <div className="flex flex-wrap items-start gap-2 sm:flex-col sm:items-end">
              <span className="font-mono text-base font-semibold text-plw-navy">
                +506 {lead.phone.slice(0, 4)} {lead.phone.slice(4)}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={['do_not_call', 'wrong_number'].includes(lead.status)}
                onClick={() => {
                  changeDialNumber(lead.phone);
                  setNotice(
                    `Número de ${lead.business_name} cargado en el teléfono. Pulse llamar para iniciar.`
                  );
                }}
              >
                Cargar en teléfono
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(editing === lead.id ? null : lead.id)}
                aria-expanded={editing === lead.id}
              >
                Registrar resultado
              </Button>
            </div>
          </div>
          {editing === lead.id && (
            <DentalLeadEditor
              lead={lead}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                reload();
              }}
            />
          )}
        </article>
      ))}
    </div>
  );
}
