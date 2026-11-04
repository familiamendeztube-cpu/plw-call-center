import type { Prospect } from '@/features/leads/models/prospect';

/** An approved Chatwoot template whose only blanks are in its body ({{1}} or {{customer_name}}). */
export interface WhatsAppTemplate {
  name: string;
  language: string;
  category: string;
  body: string;
  params: string[];
}

/** The body as the customer will read it; blanks still empty stay as {{name}}. */
export function previewTemplate(
  template: WhatsAppTemplate,
  values: Record<string, string>
): string {
  return template.body.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (blank, param: string) =>
    values[param]?.trim() ? values[param].trim() : blank
  );
}

// A WhatsApp profile without a name leaves the number as the contact name: never greet a number.
const customerName = (prospect: Prospect) =>
  /\p{L}/u.test(prospect.contactName) ? prospect.contactName.trim() : '';

// The owner's rules (2026-11-04) for the approved templates. A new template with blanks needs its
// own entry here; until then the agent types its values.
const TEMPLATE_FIELDS: Record<string, Record<string, (prospect: Prospect) => string>> = {
  plw_seguimiento_conversacion_presencial: { 1: customerName },
  plw_seguimiento_solicitud_web: {
    1: customerName,
    2: (prospect) => prospect.businessCategory.trim(),
  },
};

/**
 * What a blank holds before the agent types anything, from the customer record. The agent reviews
 * it, can change it, and must type anything left empty before the template can be sent.
 */
export function suggestTemplateValue(
  param: string,
  template: WhatsAppTemplate,
  prospect: Prospect
): string {
  return TEMPLATE_FIELDS[template.name]?.[param]?.(prospect) ?? '';
}
