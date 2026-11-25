import { z } from 'zod';

export type FormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: string;
};

/** Primer mensaje de error de cada campo. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const flat = z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
  const out: Record<string, string> = {};
  for (const [key, messages] of Object.entries(flat)) {
    if (messages?.[0]) out[key] = messages[0];
  }
  return out;
}

/** Lee campos de texto de un FormData; los que faltan (o son archivos) llegan como ''. */
export function formStrings<K extends string>(fd: FormData, keys: readonly K[]): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of keys) {
    const value = fd.get(key);
    out[key] = typeof value === 'string' ? value : '';
  }
  return out;
}
