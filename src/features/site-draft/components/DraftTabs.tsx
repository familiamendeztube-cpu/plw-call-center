import { useState } from 'react';
import { Bot, Globe } from 'lucide-react';
import { SiteDraftCard } from './SiteDraftCard';
import { SecretarySection } from './SecretarySection';
import type { Prospect } from '@/features/leads/models/prospect';
import { guessSecretaryType } from '../models/siteDraft';

export type DraftTab = 'sitio' | 'secretaria';

const TABS: Array<{ id: DraftTab; label: string; icon: typeof Globe }> = [
  { id: 'sitio', label: 'Muestra de sitio web', icon: Globe },
  { id: 'secretaria', label: 'Secretaria IA', icon: Bot },
];

interface DraftTabsProps {
  prospect: Prospect;
  /** The signed-in agent; the administrator opens both tabs read-write for verification. */
  canEdit: boolean;
}

/** Adjacent "Muestra de sitio web | Secretaria IA" tabs sharing the same draft and token. */
export function DraftTabs({ prospect, canEdit }: DraftTabsProps) {
  const [tab, setTab] = useState<DraftTab>('sitio');

  return (
    <div className="grid gap-3">
      <div role="tablist" aria-label="Muestra y secretaria" className="flex gap-1 rounded-lg bg-neutral-100 p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
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
      {tab === 'sitio' ? (
        <SiteDraftCard prospect={prospect} canEdit={canEdit} />
      ) : (
        <SecretarySection
          prospectId={prospect.id}
          defaultName={prospect.businessName}
          defaultType={guessSecretaryType(prospect.businessCategory)}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}
