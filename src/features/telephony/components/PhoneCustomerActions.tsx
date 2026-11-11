import { CalendarClock, FileText, Mail, Presentation } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
  CUSTOMER_ACTION_PARAM,
  CUSTOMER_ACTION_SCHEDULE,
  CUSTOMER_PARAM,
  CUSTOMER_TAB_PARAM,
  type CustomerTab,
} from '@/features/customers/models/customerLinks';

interface CustomerActionButtonProps {
  label: string;
  icon: typeof Mail;
  disabled: boolean;
  onClick: () => void;
}

function CustomerActionButton({ label, icon: Icon, disabled, onClick }: CustomerActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-2xl border border-neutral-200 bg-white px-2 py-3 text-center text-sm font-semibold text-plw-navy transition-all duration-150 hover:border-plw-gold hover:bg-plw-ivory focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plw-gold/60 enabled:active:scale-[0.97] disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-transparent disabled:text-neutral-400"
    >
      <Icon size={20} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export function PhoneCustomerActions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const hasCustomer = searchParams.has(CUSTOMER_PARAM);

  const openTab = (tab: CustomerTab) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set(CUSTOMER_TAB_PARAM, tab);
      return next;
    });
  };

  const scheduleCall = () => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set(CUSTOMER_ACTION_PARAM, CUSTOMER_ACTION_SCHEDULE);
      return next;
    });
  };

  return (
    <section aria-labelledby="phone-customer-actions" className="flex flex-col gap-3">
      <h3
        id="phone-customer-actions"
        className="text-xs font-semibold uppercase tracking-wider text-neutral-500"
      >
        Cliente seleccionado
      </h3>
      {hasCustomer ? null : (
        <p className="text-xs leading-relaxed text-neutral-500">
          Abre un cliente en Clientes para usar estas acciones.
        </p>
      )}
      {hasCustomer ? (
        <p className="text-xs leading-relaxed text-neutral-500">
          Compartir material estará disponible cuando se publique la biblioteca de material.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <CustomerActionButton
          label="Responder"
          icon={Mail}
          disabled={!hasCustomer}
          onClick={() => openTab('correo')}
        />
        <CustomerActionButton
          label="Ver presentación"
          icon={Presentation}
          disabled={!hasCustomer}
          onClick={() => openTab('material')}
        />
        <CustomerActionButton
          label="Agendar llamada"
          icon={CalendarClock}
          disabled={!hasCustomer}
          onClick={scheduleCall}
        />
        <CustomerActionButton
          label="Compartir material"
          icon={FileText}
          disabled
          onClick={() => undefined}
        />
      </div>
    </section>
  );
}
