import { toCostaRicaNumber } from '@/features/telephony/models/call';

export const MAX_LEADS_PER_IMPORT = 500;

export interface OutboundLeadDraft {
  phone: string;
  contact_name: string;
  business_name: string;
}

export interface LeadImportPreview {
  valid: OutboundLeadDraft[];
  invalid: { line: number; text: string }[];
  duplicates: number;
  tooMany: boolean;
}

export function parseLeadImport(text: string): LeadImportPreview {
  const valid: OutboundLeadDraft[] = [];
  const invalid: LeadImportPreview['invalid'] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;

    const [phoneField = '', contactName = '', businessName = ''] = line.split(/[\t;,]/);
    const phone = toCostaRicaNumber(phoneField);
    if (!phone) {
      invalid.push({ line: index + 1, text: line });
      return;
    }
    if (seen.has(phone)) {
      duplicates += 1;
      return;
    }
    seen.add(phone);
    valid.push({
      phone,
      contact_name: contactName.trim().slice(0, 120),
      business_name: businessName.trim().slice(0, 160),
    });
  });

  return {
    valid,
    invalid,
    duplicates,
    tooMany: valid.length > MAX_LEADS_PER_IMPORT,
  };
}
