import iconv from 'iconv-lite';

export function quoteDatevField(value: string): string {
  if (value === '') {
    return '';
  }
  if (/[\r\n;"]/.test(value) || /^[=+\-@]/.test(value)) {
    throw new Error(`DATEV field contains unsupported characters: ${value}`);
  }
  return `"${value.replace(/"/g, '""')}"`;
}

export function formatDatevMoney(amount: string): string {
  const normalized = amount.replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid DATEV money amount: ${amount}`);
  }
  return parsed.toFixed(2).replace('.', ',');
}

export function formatDatevDateDdMm(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new Error(`Invalid ISO date for DATEV Belegdatum: ${isoDate}`);
  }
  return `${match[3]}${match[2]}`;
}

export function formatDatevTimestampUtc(createdAt: Date): string {
  const year = createdAt.getUTCFullYear();
  const month = String(createdAt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(createdAt.getUTCDate()).padStart(2, '0');
  const hours = String(createdAt.getUTCHours()).padStart(2, '0');
  const minutes = String(createdAt.getUTCMinutes()).padStart(2, '0');
  const seconds = String(createdAt.getUTCSeconds()).padStart(2, '0');
  const millis = String(createdAt.getUTCMilliseconds()).padStart(3, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}${millis.slice(0, 1)}`;
}

export function formatDatevYmd(isoDate: string): string {
  return isoDate.replaceAll('-', '');
}

export function joinDatevRow(fields: string[]): string {
  return fields.join(';');
}

export function encodeDatevCsv(content: string): Buffer {
  return iconv.encode(content, 'win1252');
}

export function decodeDatevCsv(bytes: Buffer): string {
  return iconv.decode(bytes, 'win1252');
}

export function assertDatevEncodable(value: string): void {
  const encoded = iconv.encode(value, 'win1252');
  const roundTrip = iconv.decode(encoded, 'win1252');
  if (roundTrip !== value) {
    throw new Error(`DATEV field is not encodable in Windows-1252: ${value}`);
  }
}
