/** Tramo de duración por tamaño de grupo (de min a max personas, ambos incluidos). */
export type DurationRule = { minParty: number; maxParty: number; durationMin: number };

export type BookingSettings = {
  defaultDurationMin: number;
  durationRules: DurationRule[];
  minAdvanceMin: number;
  maxAdvanceDays: number;
  maxOnlineParty: number;
  cancelLimitHours: number;
  autoConfirm: boolean;
};

/** Si el restaurante aún no ha guardado sus ajustes (mismos valores por defecto que la tabla booking_settings). */
export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  defaultDurationMin: 90,
  durationRules: [],
  minAdvanceMin: 60,
  maxAdvanceDays: 60,
  maxOnlineParty: 8,
  cancelLimitHours: 2,
  autoConfirm: true,
};

/** Duraciones que se pueden elegir: de 30 min a 6 h, cada 15 min. */
export const DURATION_OPTIONS: readonly number[] = Array.from({ length: 23 }, (_, i) => 30 + i * 15);

/** La duración del tramo que contiene party_size; si ninguno, la de por defecto (igual que public.reservation_duration). */
export function durationFor(partySize: number, settings: Pick<BookingSettings, 'defaultDurationMin' | 'durationRules'>): number {
  const rule = settings.durationRules.find((r) => partySize >= r.minParty && partySize <= r.maxParty);
  return rule ? rule.durationMin : settings.defaultDurationMin;
}

/** Primer par de tramos que se solapan (índices), o null. */
export function overlappingRules(rules: readonly DurationRule[]): [number, number] | null {
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      if (rules[i].minParty <= rules[j].maxParty && rules[j].minParty <= rules[i].maxParty) return [i, j];
    }
  }
  return null;
}

/** 90 → '1 h 30 min'; 60 → '1 h'; 45 → '45 min'. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
