import type { DentalCall } from '../models/dentalDialer';
import type { DentalLead } from '../models/dentalLead';
import { followUpNote, followUps } from '../models/followUps';
import { DentalLeadList } from './DentalLeadList';

/** The agent's to-do list from Anna's calls: who is interested and who to call back. */
export function DentalFollowUps({
  leads,
  calls,
  agentNames,
  reload,
}: {
  leads: DentalLead[];
  calls: DentalCall[];
  agentNames: Record<string, string>;
  reload: () => void;
}) {
  const { interested, callback } = followUps(leads, calls);
  const groups = [
    {
      title: 'Interesados',
      hint: 'Mostraron interés. Contáctelos y registre el resultado.',
      items: interested,
    },
    {
      title: 'Volver a llamar',
      hint: 'Anna no pudo hablar con la persona encargada, o le pidieron llamar en otro momento.',
      items: callback,
    },
  ];
  return (
    <div className="grid gap-6">
      {groups.map(({ title, hint, items }) => (
        <section key={title} className="grid gap-3" aria-label={title}>
          <div>
            <h2 className="text-lg font-semibold text-plw-gold-soft">
              {title} ({items.length})
            </h2>
            <p className="text-sm text-neutral-600">{hint}</p>
          </div>
          {items.length ? (
            <DentalLeadList
              leads={items.map((item) => item.lead)}
              agentNames={agentNames}
              reload={reload}
              callNotes={Object.fromEntries(
                items.map((item) => [item.lead.id, followUpNote(item.call)])
              )}
            />
          ) : (
            <p className="rounded-xl border bg-white p-5 text-sm text-neutral-600">
              No hay dentistas en esta lista por ahora.
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
