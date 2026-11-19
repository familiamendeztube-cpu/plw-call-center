import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { DraftTabs } from './DraftTabs';
import type { Prospect } from '@/features/leads/models/prospect';

vi.mock('@/integrations/supabase/client', () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  const client = { from: () => builder, rpc: () => Promise.resolve({ error: null }) };
  return { getSupabaseClient: () => client };
});

// Agents build website samples for every kind of customer, not only tourism: hiding the
// tab for a "Taller" customer left agents with Secretaria IA only (regression, 11-19).
test('a non-tourism customer still gets the website sample tab, opened first', () => {
  const prospect = {
    id: 'taller-1',
    businessName: 'Taller M y M Grecia',
    businessCategory: 'Taller mecánico',
    phone: '88881234',
  } as Prospect;
  render(<DraftTabs prospect={prospect} canEdit />);

  const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
  expect(tabs).toEqual(['Muestra de sitio web', 'Secretaria IA']);
  expect(screen.getByRole('tab', { name: 'Muestra de sitio web' }).getAttribute('aria-selected')).toBe('true');
});
