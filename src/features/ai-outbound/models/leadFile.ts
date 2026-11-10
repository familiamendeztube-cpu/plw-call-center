import { readSheet } from 'read-excel-file/browser';
import { cellToText, parseCsvText } from '@/features/ai-outbound/models/outboundLead';

const SPREADSHEET_EXTENSION = /\.xlsx$/i;

export async function readLeadFile(file: File): Promise<string[][]> {
  if (SPREADSHEET_EXTENSION.test(file.name)) {
    const sheet = await readSheet(file);
    return sheet.map((row) => row.map(cellToText));
  }
  return parseCsvText(await file.text());
}
