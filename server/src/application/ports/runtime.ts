/** Zaman kaynagi. Use case'ler `new Date()` yerine bunu kullanir; testte sabitlenir. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Yapilandirilmis log arayuzu (pino ile uyumlu alt kume). */
export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}
