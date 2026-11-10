export const DENTAL_STATUS = {
  pending: 'Pendiente',
  contacted: 'Contactado',
  interested: 'Interesado',
  callback: 'Volver a llamar',
  not_interested: 'No interesado',
  wrong_number: 'Número incorrecto',
  do_not_call: 'No llamar',
} as const;
export type DentalStatus = keyof typeof DENTAL_STATUS;
export interface DentalLead {
  id: string;
  campaign_id: string;
  phone: string;
  business_name: string;
  contact_name: string;
  province: string;
  canton: string;
  address: string;
  source_url: string;
  source_name: string;
  source_checked_at: string;
  verification: 'directory' | 'primary' | 'phone_confirmed';
  owner_staff_id: string | null;
  status: DentalStatus;
  notes: string;
  updated_at: string;
}
export interface DentalCampaign {
  id: string;
  name: string;
  planned_start_at: string | null;
  timezone: string;
  concurrent_per_agent: number;
  automation_status: string;
  readiness_note: string;
}
export interface DentalFilter {
  query: string;
  province: string;
  owner: string;
  status: string;
}
const normalized = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
export function filterDentalLeads(leads: DentalLead[], filter: DentalFilter) {
  const query = normalized(filter.query.trim());
  return leads.filter(
    (l) =>
      (!filter.province || l.province === filter.province) &&
      (!filter.owner ||
        (filter.owner === 'unassigned' ? !l.owner_staff_id : l.owner_staff_id === filter.owner)) &&
      (!filter.status || l.status === filter.status) &&
      (!query ||
        normalized(
          [l.business_name, l.contact_name, l.phone, l.canton, l.province].join(' ')
        ).includes(query))
  );
}
export function dentalCounts(leads: DentalLead[]) {
  return {
    total: leads.length,
    pending: leads.filter((l) => l.status === 'pending').length,
    interested: leads.filter((l) => l.status === 'interested').length,
    callback: leads.filter((l) => l.status === 'callback').length,
  };
}
export const sourceLabel = (v: DentalLead['verification']) =>
  ({
    directory: 'Directorio público',
    primary: 'Sitio de la clínica o asociación',
    phone_confirmed: 'Confirmado por llamada',
  })[v];
