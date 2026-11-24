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
