export function preferredCallWindows(durationMinutes: number, now = Date.now()) {
  const step = 30 * 60_000;
  const first = Math.ceil((now + 60_000) / step) * step;
  return Array.from({ length: 7 * 48 }, (_, index) => {
    const start = first + index * step;
    return { id: `preferred-${start}`, slotStart: new Date(start).toISOString(), slotEnd: new Date(start + durationMinutes * 60_000).toISOString(), durationMinutes };
  });
}

export function normalizeCallPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  const number = digits.length === 10 ? `+91${digits}` : `+${digits}`;
  if (!/^\+[1-9]\d{7,14}$/.test(number)) throw new Error('Enter a valid phone number with country code.');
  return number;
}

export function withoutCharges(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCharges);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/amount|price|cost|charge|billing|tariff|credit|settlement/i.test(key)).map(([key, item]) => [key, withoutCharges(item)]));
}
