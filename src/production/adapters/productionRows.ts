export function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') {
    throw new Error(`Fila inválida: el campo ${key} no es texto.`);
  }
  return value;
}

export function readNullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`Fila inválida: el campo ${key} no es texto.`);
  }
  return value;
}

export function readBoolean(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (typeof value !== 'boolean') {
    throw new Error(`Fila inválida: el campo ${key} no es verdadero o falso.`);
  }
  return value;
}

export function readEnum<T extends string>(
  row: Record<string, unknown>,
  key: string,
  values: readonly T[]
): T {
  const value = readString(row, key);
  const match = values.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new Error(`Fila inválida: el campo ${key} tiene un valor no reconocido.`);
  }
  return match;
}

export function readRows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) {
    throw new Error('Respuesta inválida del servicio.');
  }
  return data.map((row) => {
    if (row === null || typeof row !== 'object') {
      throw new Error('Fila inválida del servicio.');
    }
    return row as Record<string, unknown>;
  });
}

export function readOptionalRow(data: unknown): Record<string, unknown> | null {
  if (data === null) return null;
  const [row] = readRows([data]);
  return row ?? null;
}
