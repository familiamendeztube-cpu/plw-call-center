import { describe, expect, it } from 'vitest';
import { parseCsvText } from '@/features/ai-outbound/models/outboundLead';

describe('parseCsvText', () => {
  it('reads quoted fields with commas and escaped quotes', () => {
    const rows = parseCsvText('2222-3333,"Soto, Textiles","Ana ""Tita"" Soto",Ropa');
    expect(rows).toEqual([['2222-3333', 'Soto, Textiles', 'Ana "Tita" Soto', 'Ropa']]);
  });

  it('detects semicolon and tab delimiters from the first line', () => {
    expect(parseCsvText('telefono;negocio\n8888-1234;Ferretería')).toEqual([
      ['telefono', 'negocio'],
      ['8888-1234', 'Ferretería'],
    ]);
    expect(parseCsvText('8888-1234\tFerretería')).toEqual([['8888-1234', 'Ferretería']]);
  });
});

