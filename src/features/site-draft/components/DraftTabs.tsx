import { useState } from 'react';
import { Bot, Globe } from 'lucide-react';
import { SiteDraftCard } from './SiteDraftCard';
import { SecretarySection } from './SecretarySection';
import type { Prospect } from '@/features/leads/models/prospect';

export type DraftTab = 'sitio' | 'secretaria';

const TABS: Array<{ id: DraftTab; label: string; icon: typeof Globe }> = [
  { id: 'sitio', label: 'Muestra de sitio web', icon: Globe },
  { id: 'secretaria', label: 'Secretaria IA', icon: Bot },
];

// The website samples are tourism templates only (tours / lodging); the secretary demo
// covers every business type. Categories are free text, so match loosely and accent-free.
const TOURISM = /turis|tour|hosped|hotel|cabin|alojam|hostal|lodge|viaje/;

function isTourismCategory(category: string): boolean {
  return TOURISM.test(category.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase());
}

interface DraftTabsProps {
  prospect: Prospect;
  /** The signed-in agent; the administrator opens both tabs read-write for verification. */
  canEdit: boolean;
}

/** Adjacent "Muestra de sitio web | Secretaria IA" tabs sharing the same draft and token. */
export function DraftTabs({ prospect, canEdit }: DraftTabsProps) {
  const tourism = isTourismCategory(prospect.businessCategory);
  const tabs = tourism ? TABS : TABS.filter(({ id }) => id === 'secretaria');
  const [tab, setTab] = useState<DraftTab>(tabs[0].id);

  return (
    <div className="grid gap-3">
      {tabs.length > 1 ? (
        <div role="tablist" aria-label="Muestra y secretaria" className="flex gap-1 rounded-lg bg-neutral-100 p-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === id
                  ? 'bg-white text-plw-navy shadow-sm'
                  : 'text-neutral-500 hover:text-plw-navy'
              }`}
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {tab === 'sitio' ? (
        <SiteDraftCard prospect={prospect} canEdit={canEdit} />
      ) : (
        <SecretarySection
          prospectId={prospect.id}
          defaultName={prospect.businessName}
          defaultType={tourism ? 'tourism' : 'services'}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}
