import { toCostaRicaNumber } from '@/features/telephony/models/call';

export const MAX_LEADS_PER_IMPORT = 500;

export interface OutboundLeadDraft {
  phone: string;
  contact_name: string;
  business_name: string;
  business_type: string;
}

export interface LeadImportPreview {
  valid: OutboundLeadDraft[];
  invalid: { line: number; text: string }[];
  duplicates: number;
  doNotCall: number;
  tooMany: boolean;
}

type LeadColumn = keyof OutboundLeadDraft;

const DEFAULT_COLUMNS: LeadColumn[] = ['phone', 'business_name', 'contact_name', 'business_type'];

const HEADER_ALIASES: Record<LeadColumn, string[]> = {
  phone: ['telefono', 'phone', 'celular', 'numero', 'whatsapp', 'tel'],
  business_name: ['negocio', 'nombre del negocio', 'empresa', 'business', 'business name'],
  contact_name: ['contacto', 'nombre', 'persona', 'contact', 'contact name'],
  business_type: ['tipo', 'tipo de negocio', 'giro', 'rubro', 'type', 'business type'],
};

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function detectColumns(headerRow: string[]): LeadColumn[] | null {
  const columns: LeadColumn[] = [];
  for (const cell of headerRow) {
    const normalized = normalizeHeader(cell);
    const match = (Object.keys(HEADER_ALIASES) as LeadColumn[]).find((column) =>
      HEADER_ALIASES[column].includes(normalized)
    );
    if (match) columns.push(match);
  }
  return columns.includes('phone') ? columns : null;
}

export function parseCsvText(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes('\t')
    ? '\t'
    : (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? ';'
      : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.trim();
  return '';
}

export function parseLeadRows(rows: string[][], doNotCallPhones: ReadonlySet<string>): LeadImportPreview {
  const preview: LeadImportPreview = {
    valid: [],
    invalid: [],
    duplicates: 0,
    doNotCall: 0,
    tooMany: false,
  };
  const seen = new Set<string>();

  const firstRow = rows[0] ?? [];
  const headerColumns = detectColumns(firstRow);
  const columns = headerColumns ?? DEFAULT_COLUMNS;
  const dataRows = headerColumns ? rows.slice(1) : rows;
  const firstDataLine = headerColumns ? 2 : 1;

  dataRows.forEach((cells, offset) => {
    const line = firstDataLine + offset;
    if (cells.every((cell) => !cell.trim())) return;

    const record: Partial<OutboundLeadDraft> = {};
    columns.forEach((column, position) => {
      record[column] = (cells[position] ?? '').trim();
    });

    const phone = toCostaRicaNumber(record.phone ?? '');
    if (!phone) {
      preview.invalid.push({ line, text: cells.join(' | ') });
      return;
    }
    if (doNotCallPhones.has(phone)) {
      preview.doNotCall += 1;
      return;
    }
    if (seen.has(phone)) {
      preview.duplicates += 1;
      return;
    }
    seen.add(phone);
    preview.valid.push({
      phone,
      contact_name: (record.contact_name ?? '').slice(0, 120),
      business_name: (record.business_name ?? '').slice(0, 160),
      business_type: (record.business_type ?? '').slice(0, 120),
    });
  });

  preview.tooMany = preview.valid.length > MAX_LEADS_PER_IMPORT;
  return preview;
}
