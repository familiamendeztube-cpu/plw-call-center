import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SecretarySection } from './SecretarySection';

// The mock module exposes a setter so each test can choose the load outcome.
type FromResult = { data: unknown; error: { message: string } | null };

const mockModule = vi.hoisted(() => ({
  current: { data: null, error: null } as { data: unknown; error: { message: string } | null },
}));

vi.mock('@/integrations/supabase/client', () => {
  // Built once: the real client is a stable singleton, and the component's effect
  // depends on the client object, so a per-call object would loop the load effect.
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve(mockModule.current),
  };
  const client = { from: () => builder, rpc: () => Promise.resolve({ error: null }) };
  return { getSupabaseClient: () => client };
});

function setLoadOutcome(next: FromResult) {
  mockModule.current = next;
}

// Exercises the real SecretarySection load: a full (valid, snake_case) draft row from the
// database flows through draftFromRow, then the form prefills and the demo links render.
// Regression: an undefined `loaded` inside the load callback left the tab on Cargando…
// forever with a ReferenceError, and the mapper alone did not catch it.

const TOKEN = 'c'.repeat(48);

const FULL_DRAFT_ROW = {
  prospect_id: 'bruma-1',
  site_slug: 'plw-tourism-tours',
  business_name: 'Bosque de Bruma Tours',
  locale: 'Heredia',
  category: 'tours',
  services: ['Caminata al volcán'],
  highlight: 'Puentes colgantes',
  booking_phone: '',
  description: '',
  facts: [],
  faqs: [],
  approved_images: [],
  secretary_name: 'Bosque de Bruma Tours',
  secretary_type: 'tourism',
  preview_token: TOKEN,
  shared_at: null,
};

let fromResult: FromResult;

beforeEach(() => {
  fromResult = { data: FULL_DRAFT_ROW, error: null };
  setLoadOutcome(fromResult);
});

afterEach(() => {
  // Testing Library only auto-cleans up when globals expose afterEach; be explicit
  // so one render's Cargando… span never bleeds into the next test.
  document.body.innerHTML = '';
});

function renderSection() {
  return render(
    <SecretarySection
      prospectId="bruma-1"
      defaultName="Bosque de Bruma Tours"
      defaultPhone=""
      defaultType="tourism"
      canEdit={true}
    />
  );
}

test('a valid draft resolves past Cargando…, prefills, and shows all three link actions', async () => {
  renderSection();

  const link = await screen.findByRole('link', { name: /Abrir demo/ });
  expect(link.getAttribute('href')).toBe(
    `https://familiamendeztube-cp-q9tc.bolt.host/preview/plw-${TOKEN}/secretaria`
  );
  expect(screen.queryByText('Cargando…')).toBeNull();
  expect(screen.getByRole('button', { name: 'Copiar enlace' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Copiar ambos enlaces' })).toBeTruthy();
  expect((screen.getByLabelText('Nombre del negocio') as HTMLInputElement).value).toBe(
    'Bosque de Bruma Tours'
  );
  expect(screen.getByRole('button', { name: 'Copiar ambos enlaces' })).toBeTruthy();
});

test('a failed load shows a visible, retryable error instead of hanging', async () => {
  setLoadOutcome({ data: null, error: { message: 'fetch failed' } });
  renderSection();

  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Cargando…')).toBeNull();
});

test('a draft row without a token shows the create-the-sample route, not a hang', async () => {
  setLoadOutcome({ data: null, error: null });
  renderSection();

  expect(await screen.findByText(/Aún no hay muestra de sitio web/)).toBeTruthy();
  expect(screen.queryByText('Cargando…')).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
});

test('copying the demo link writes it to the clipboard', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  renderSection();

  await screen.findByRole('link', { name: /Abrir demo/ });
  // userEvent's pointer-events check refuses clicks inside this section in jsdom;
  // a plain click exercises the same handler.
  fireEvent.click(screen.getByRole('button', { name: 'Copiar enlace' }));
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(
      `https://familiamendeztube-cp-q9tc.bolt.host/preview/plw-${TOKEN}/secretaria`
    )
  );
});
