import { describe, expect, it } from 'vitest';
import { parseCsvText, parseLeadRows } from '@/features/ai-outbound/models/outboundLead';

const NO_DNC = new Set<string>();

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

describe('parseLeadRows', () => {
  it('maps Spanish headers to columns in any order', () => {
    const preview = parseLeadRows(
      [
        ['Tipo de negocio', 'Contacto', 'Teléfono', 'Negocio'],
        ['Salón', 'Lucía', '+506 8888-1234', 'Salón Bella'],
      ],
      NO_DNC
    );
    expect(preview.valid).toEqual([
      {
        phone: '88881234',
        contact_name: 'Lucía',
        business_name: 'Salón Bella',
        business_type: 'Salón',
      },
    ]);
    expect(preview.invalid).toEqual([]);
  });

  it('uses phone, business, contact, type order when there is no header', () => {
    const preview = parseLeadRows([['2222-5678', 'Soto Textiles', 'María', 'Ropa']], NO_DNC);
    expect(preview.valid[0]).toMatchObject({
      phone: '22225678',
      business_name: 'Soto Textiles',
      contact_name: 'María',
      business_type: 'Ropa',
    });
  });

  it('reports invalid numbers with their row number', () => {
    const preview = parseLeadRows(
      [
        ['Teléfono', 'Negocio'],
        ['12345', 'Muy corto'],
        ['9999-0000', 'Número móvil fuera de rango'],
        ['8888-1234', 'Válido'],
      ],
      NO_DNC
    );
    expect(preview.valid.map((lead) => lead.phone)).toEqual(['88881234']);
    expect(preview.invalid.map((item) => item.line)).toEqual([2, 3]);
  });

  it('counts duplicates within the file and excludes do-not-call numbers', () => {
    const preview = parseLeadRows(
      [
        ['8888-1234', 'Uno'],
        ['88881234', 'Repetido'],
        ['2222-5678', 'No llamar'],
        ['2233-4455', 'Otro'],
      ],
      new Set(['22225678'])
    );
    expect(preview.valid.map((lead) => lead.business_name)).toEqual(['Uno', 'Otro']);
    expect(preview.duplicates).toBe(1);
    expect(preview.doNotCall).toBe(1);
  });

  it('skips blank rows', () => {
    const preview = parseLeadRows([['', ''], ['8888-1234', 'Uno']], NO_DNC);
    expect(preview.valid).toHaveLength(1);
    expect(preview.invalid).toEqual([]);
  });
});
