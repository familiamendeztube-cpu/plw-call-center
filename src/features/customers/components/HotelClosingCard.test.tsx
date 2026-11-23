import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { HotelClosingCard } from './HotelClosingCard';

// The closing card is Alejandro's script on paper: published prices plus the margin
// math the hotel can verify with their own nightly rate. es-CR formats thousands with
// a narrow no-break space, so the amount matchers stay whitespace-agnostic.

afterEach(() => {
  document.body.innerHTML = '';
});

describe('HotelClosingCard', () => {
  test('shows the published prices without requiring any input', () => {
    render(<HotelClosingCard />);
    expect(screen.getByText(/₡200\s000/)).toBeTruthy();
    expect(screen.getAllByText(/₡100\s000/).length).toBeGreaterThan(0);
    expect(screen.getByText(/pago único/)).toBeTruthy();
    expect(screen.getByText(/sin contrato anual/)).toBeTruthy();
  });

  test('the margin math follows the rate and incremental bookings the hotel confirms', () => {
    render(<HotelClosingCard />);
    const rate = screen.getByLabelText('Precio por noche (₡)') as HTMLInputElement;
    const bookings = screen.getByLabelText('Reservas directas nuevas / mes') as HTMLInputElement;
    // Defaults: 45.000/night, 3 bookings -> 135.000 revenue, 35.000 margin;
    // setup amortized over 6 months (200.000/6 + 100.000) needs 3 nights to break even.
    expect(screen.getByText(/su margen es ₡35\s000 al mes/)).toBeTruthy();
    expect(screen.getByText(/se recupera con 3 reserva/)).toBeTruthy();
    fireEvent.change(rate, { target: { value: '60000' } });
    fireEvent.change(bookings, { target: { value: '5' } });
    expect(screen.getByText(/su margen es ₡200\s000 al mes/)).toBeTruthy();
    expect(screen.getByText(/5 reservas directas nuevas/)).toBeTruthy();
  });

  test('a zero booking count still shows the breakeven, never negative nonsense', () => {
    render(<HotelClosingCard />);
    fireEvent.change(screen.getByLabelText('Reservas directas nuevas / mes'), { target: { value: '0' } });
    expect(screen.getByText(/se recupera con 3 reserva/)).toBeTruthy();
  });

  test('closing and objecting announce through the same event the workspace listens to', () => {
    const events: string[] = [];
    const listener = (event: Event) => events.push((event as CustomEvent).detail);
    window.addEventListener('plw:hotel-demo-close', listener);
    try {
      render(<HotelClosingCard />);
      fireEvent.click(screen.getByRole('button', { name: /Cerrar para instalación/ }));
      expect(events).toEqual(['instalacion']);
      fireEvent.click(screen.getByRole('button', { name: /Registrar objeción/ }));
      fireEvent.change(screen.getByLabelText(/objectó el hotel/), { target: { value: 'Muy caro' } });
      fireEvent.submit(screen.getByLabelText(/objectó el hotel/).closest('form')!);
      expect(events).toEqual(['instalacion', 'objeción: Muy caro']);
    } finally {
      window.removeEventListener('plw:hotel-demo-close', listener);
    }
  });

  test('an empty objection is never dispatched', () => {
    const events: string[] = [];
    const listener = (event: Event) => events.push((event as CustomEvent).detail);
    window.addEventListener('plw:hotel-demo-close', listener);
    try {
      render(<HotelClosingCard />);
      fireEvent.click(screen.getByRole('button', { name: /Registrar objeción/ }));
      fireEvent.submit(screen.getByLabelText(/objectó el hotel/).closest('form')!);
      expect(events).toEqual([]);
    } finally {
      window.removeEventListener('plw:hotel-demo-close', listener);
    }
  });
});
