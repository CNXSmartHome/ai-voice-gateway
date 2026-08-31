import { registerDecorator, type ValidationOptions } from 'class-validator';

/**
 * Checks a value against the runtime's IANA time zone database.
 *
 * Asking the platform rather than carrying a list: the zone database changes
 * — governments move the clocks — and a hard-coded set would be wrong within
 * a year and wrong differently from the runtime that actually does the
 * arithmetic. `Intl.DateTimeFormat` throws a `RangeError` for a zone it does
 * not know, which is exactly the question being asked.
 */
export function isValidTimezone(value: unknown): boolean {
  if (typeof value !== 'string' || value === '') return false;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function IsTimezone(options?: ValidationOptions) {
  return function decorate(target: object, propertyName: string): void {
    registerDecorator({
      name: 'isTimezone',
      target: target.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be an IANA time zone, such as Asia/Bangkok`,
        ...options,
      },
      validator: { validate: (value: unknown) => isValidTimezone(value) },
    });
  };
}
