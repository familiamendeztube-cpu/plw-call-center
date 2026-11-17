export const CUSTOMER_PARAM = 'cliente';
export const CUSTOMER_TAB_PARAM = 'pestana';
export const CUSTOMER_ACTION_PARAM = 'accion';

export type CustomerTab = 'correo' | 'llamada' | 'whatsapp' | 'oferta' | 'material';

export const CUSTOMER_TABS: CustomerTab[] = ['correo', 'llamada', 'whatsapp', 'oferta', 'material'];

export const CUSTOMER_ACTION_SCHEDULE = 'agendar';
/** With accion=agendar: the follow-up's reason, prefilled (e.g. the AI caller's preferred time). */
export const CUSTOMER_REASON_PARAM = 'motivo';

export function parseCustomerTab(value: string | null): CustomerTab {
  return CUSTOMER_TABS.find((tab) => tab === value) ?? 'correo';
}
