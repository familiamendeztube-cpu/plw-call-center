import { useState } from 'react';
import { Banknote, CalendarCheck2, StickyNote, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

/**
 * Alejandro's closing card: published prices, the hotel's own margin per incremental direct
 * reservation, and the breakeven math. Numbers the hotel can verify with their own rate.
 */

const SETUP_CRC = 200000;
const MONTHLY_CRC = 100000;
const crc = (value: number) => `₡${value.toLocaleString('es-CR')}`;

export function HotelClosingCard() {
  const [rate, setRate] = useState(45000); // typical nightly rate typed live with the owner
  const [nights, setNights] = useState(3); // incremental direct bookings per month, conservative
  const [objection, setObjection] = useState(false);

  const monthlyRevenue = rate * nights;
  const cost = SETUP_CRC / 6 + MONTHLY_CRC; // setup amortized over 6 months
  const breakeven = cost > 0 ? Math.ceil(cost / Math.max(rate, 1)) : 0;

  return (
    <Panel className="flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <Banknote size={18} className="text-plw-navy" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-plw-ink">Cierre: la oferta y los números del hotel</h3>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 text-sm">
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Instalación</dt>
          <dd className="mt-0.5 text-lg font-semibold text-plw-ink">{crc(SETUP_CRC)}</dd>
          <dd className="text-xs text-neutral-500">pago único, publicado</dd>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Mensualidad</dt>
          <dd className="mt-0.5 text-lg font-semibold text-plw-ink">{crc(MONTHLY_CRC)}</dd>
          <dd className="text-xs text-neutral-500">recepcionista IA es/en, sin contrato anual</dd>
        </div>
      </dl>

      <div className="grid gap-3 rounded-lg border border-plw-gold/40 bg-plw-gold-soft/20 p-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-xs font-medium text-neutral-600">Precio por noche (₡)</span>
          <input
            type="number"
            min={0}
            step={1000}
            value={rate}
            onChange={(event) => setRate(Math.max(0, Number(event.target.value) || 0))}
            className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-plw-ink"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-xs font-medium text-neutral-600">Reservas directas nuevas / mes</span>
          <input
            type="number"
            min={0}
            step={1}
            value={nights}
            onChange={(event) => setNights(Math.max(0, Number(event.target.value) || 0))}
            className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-plw-ink"
          />
        </label>
        <p className="sm:col-span-2 flex items-start gap-2 text-sm text-plw-ink">
          <TrendingUp size={15} className="mt-0.5 flex-none text-success-700" aria-hidden="true" />
          Con {nights} reservas directas nuevas al mes, el hotel recibe {crc(monthlyRevenue)} y
          paga {crc(MONTHLY_CRC)}: su margen es {crc(monthlyRevenue - MONTHLY_CRC)} al mes. La
          inversión se recupera con {breakeven || 'menos de 1'} reserva(s) directa(s) por mes.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            setObjection(false);
            // The workspace opens the follow-up dialog; nothing is recorded until it is saved.
            window.dispatchEvent(new CustomEvent('plw:hotel-demo-close', { detail: 'instalacion' }));
          }}
        >
          <CalendarCheck2 size={14} aria-hidden="true" />
          Cerrar para instalación
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setObjection((value) => !value)}>
          <StickyNote size={14} aria-hidden="true" />
          Registrar objeción
        </Button>
      </div>

      {objection ? (
        <form
          className="grid gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const note = String(new FormData(event.currentTarget).get('objection') ?? '').trim();
            if (!note) return;
            window.dispatchEvent(new CustomEvent('plw:hotel-demo-close', { detail: `objeción: ${note}` }));
            setObjection(false);
          }}
        >
          <label htmlFor="hotel-objection" className="text-xs font-medium text-neutral-600">
            ¿Qué objectó el hotel? (queda en su nota privada)
          </label>
          <textarea
            id="hotel-objection"
            name="objection"
            rows={2}
            maxLength={300}
            className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-plw-ink"
          />
          <Button type="submit" size="sm" variant="secondary" className="justify-self-start">
            Guardar objeción
          </Button>
        </form>
      ) : null}
      <p className="text-[11px] text-neutral-500">
        Los montos son los publicados por PLW. El cálculo usa el precio por noche que el propio
        hotel confirma en la llamada.
      </p>
    </Panel>
  );
}
