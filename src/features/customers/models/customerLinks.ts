export const CUSTOMER_PARAM = 'cliente';
export const CUSTOMER_TAB_PARAM = 'pestana';
export const CUSTOMER_ACTION_PARAM = 'accion';

export type CustomerTab = 'correo' | 'oferta' | 'material';

export const CUSTOMER_TABS: CustomerTab[] = ['correo', 'oferta', 'material'];

export const CUSTOMER_ACTION_SCHEDULE = 'agendar';

export function parseCustomerTab(value: string | null): CustomerTab {
  return CUSTOMER_TABS.find((tab) => tab === value) ?? 'correo';
}
