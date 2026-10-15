const sensitiveIdentifierKeys = new Set([
  'nationalid',
  'nationalidnumber',
  'passport',
  'passportnumber',
  'taxid',
  'taxpin',
  'pin',
  'ssn',
  'governmentid',
  'identitynumber',
  'otheridnumber',
  'documentnumber',
]);

export function maskIdentifier(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  return text.length <= 4 ? '••••' : `${'•'.repeat(Math.min(8, text.length - 4))}${text.slice(-4)}`;
}

export function redactSensitiveIdentifiers<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactSensitiveIdentifiers) as T;
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    const sensitive = sensitiveIdentifierKeys.has(normalizedKey)
      || normalizedKey.endsWith('taxid')
      || normalizedKey.endsWith('taxpin')
      || normalizedKey.endsWith('passportnumber')
      || normalizedKey.endsWith('nationalid')
      || normalizedKey.endsWith('otheridnumber');
    return [key, sensitive
      ? maskIdentifier(entry)
      : redactSensitiveIdentifiers(entry)];
  })) as T;
}