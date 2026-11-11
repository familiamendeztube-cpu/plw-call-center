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
      <div className="relative mt-12 max-w-xl lg:mt-0">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-plw-gold-soft">
          Espacio interno de ventas
        </p>
        <h1 className="font-display mt-4 text-4xl font-medium leading-[1.2] text-white sm:text-5xl">
          Professional Latino Workers
        </h1>
        <p className="font-display mt-2 text-2xl font-medium leading-[1.2] text-plw-gold-soft sm:text-3xl">
          Call Center
        </p>
        <p className="mt-6 max-w-md text-base leading-relaxed text-white/75">
          Gestiona conversaciones, prospectos y llamadas desde un único espacio de trabajo diseñado
          para el equipo de ventas.
        </p>
      </div>
      <p className="relative mt-12 text-xs text-white/50 lg:mt-0">
        Uso exclusivo del personal de PLW · Costa Rica
      </p>
    </section>
  );
}
