import { PlwWordmark } from '@/components/ui/PlwWordmark';
import { DemoModeBadge } from '@/components/ui/DemoModeBadge';

export function BrandPanel() {
  return (
    <section className="glass-panel relative m-3 flex flex-col justify-between overflow-hidden rounded-[28px] px-8 py-10 text-white sm:px-12 lg:m-6 lg:px-16 lg:py-14">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full border border-plw-gold/25"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full border border-white/10"
      />
      <div className="relative flex items-center justify-between gap-4">
        <PlwWordmark tone="light" />
        <DemoModeBadge />
      </div>
      <div className="relative mt-10 max-w-lg lg:mt-0">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-plw-gold-soft">
          Espacio interno de ventas
        </p>
        <h1 className="mt-3 text-3xl font-semibold leading-[1.15] tracking-tight text-white sm:text-4xl">
          Professional Latino Workers
        </h1>
        <p className="mt-1.5 text-lg font-medium text-plw-gold-soft">Call Center</p>
        <p className="mt-5 max-w-md text-sm leading-relaxed text-white/80 sm:text-base">
          Gestiona conversaciones, prospectos y llamadas desde un único espacio de trabajo diseñado
          para el equipo de ventas.
        </p>
      </div>
      <p className="relative mt-10 text-xs text-white/60 lg:mt-0">
        Uso exclusivo del personal de PLW · Costa Rica
      </p>
    </section>
  );
}
