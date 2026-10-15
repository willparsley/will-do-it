/** datetime-local controls need local calendar fields, not a sliced UTC ISO string. */
export function dateTimeLocal(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function dateTimeInstant(input: string, original?: string | null): string | null {
  // Preserve seconds, milliseconds and the exact instant during DST's repeated
  // hour when the user has not changed the minute-resolution control.
  if (input === dateTimeLocal(original)) return original || null;
  return input ? new Date(input).toISOString() : null;
}
