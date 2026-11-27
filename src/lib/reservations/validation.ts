import { z } from 'zod';
import { formStrings } from '@/lib/forms';
import { MINUTES_PER_DAY, timeToMinutes } from '@/lib/schedule';
import { isRealDate } from '@/lib/validation/schedule';
import { uuidSchema } from '@/lib/validation/schemas';
import { BOOKING_LIMITS, RESERVATION_STATUSES } from './codes';
import { normalizePhoneE164 } from './phone';
import { overlappingRules, type DurationRule } from './settings';

const REQUIRED = 'Este campo es obligatorio.';
const BAD_TIME = 'Escribe la hora así: 21:30.';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const trimmed = (max: number, message: string) => z.string().trim().max(max, message);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Como mucho ${max} caracteres.`)
    .transform((v) => (v === '' ? null : v));
const intIn = (min: number, max: number, message: string) =>
  z
    .string({ error: REQUIRED })
    .trim()
    .regex(/^\d+$/, message)
    .transform(Number)
    .pipe(z.number().int().min(min, message).max(max, message));
const checkbox = z.string().transform((v) => v === 'on');

export const isoDateSchema = z
  .string({ error: REQUIRED })
  .trim()
  .regex(ISO_DATE, { message: 'Elige una fecha.', abort: true })
  .refine(isRealDate, 'Esa fecha no existe.');

const timeSchema = z
  .string({ error: REQUIRED })
  .trim()
  .refine((v) => timeToMinutes(v) !== null, BAD_TIME)
  .transform((v) => timeToMinutes(v) as number);

const partySizeSchema = intIn(1, BOOKING_LIMITS.partySize, `Entre 1 y ${BOOKING_LIMITS.partySize} personas.`);

// Zonas y mesas ---------------------------------------------------------------------------------------------
const positionSchema = intIn(0, 999, 'Pon un número del 0 al 999.');

export const zoneFormSchema = z.object({
  name: trimmed(40, 'El nombre puede tener como mucho 40 caracteres.').min(1, 'Ponle nombre a la zona (por ejemplo, Terraza).'),
  position: positionSchema,
});

export const tableFormSchema = z
  .object({
    zoneId: z.string().trim(),
    name: trimmed(20, 'El nombre puede tener como mucho 20 caracteres.').min(1, 'Ponle nombre a la mesa (por ejemplo, T4).'),
    minCapacity: intIn(1, 50, 'Entre 1 y 50 personas.'),
    maxCapacity: intIn(1, 50, 'Entre 1 y 50 personas.'),
    position: positionSchema,
    onlineBookable: checkbox,
    active: checkbox,
  })
  .superRefine((v, ctx) => {
    if (v.zoneId !== '' && !uuidSchema.safeParse(v.zoneId).success) {
      ctx.addIssue({ code: 'custom', path: ['zoneId'], message: 'Elige una zona.' });
    }
    if (v.minCapacity > v.maxCapacity) {
      ctx.addIssue({ code: 'custom', path: ['minCapacity'], message: 'El mínimo no puede ser mayor que el máximo.' });
    }
  })
  .transform((v) => ({ ...v, zoneId: v.zoneId === '' ? null : v.zoneId }));

export const TABLE_FORM_FIELDS = ['zoneId', 'name', 'minCapacity', 'maxCapacity', 'position', 'onlineBookable', 'active'] as const;

// Ajustes de reserva -----------------------------------------------------------------------------------------
export const RULE_ROWS = [1, 2, 3, 4, 5, 6] as const;
const DURATION_MESSAGE = 'De 30 minutos a 6 horas, en pasos de 15 minutos.';
const durationSchema = intIn(30, 360, DURATION_MESSAGE).refine((v) => v % 15 === 0, DURATION_MESSAGE);

export function readSettingsForm(fd: FormData): Record<string, string> {
  const keys = [
    'defaultDuration',
    'minAdvanceMin',
    'maxAdvanceDays',
    'maxOnlineParty',
    'cancelLimitHours',
    'autoConfirm',
    ...RULE_ROWS.flatMap((n) => [`rule${n}_min`, `rule${n}_max`, `rule${n}_duration`]),
  ];
  return formStrings(fd, keys);
}

/** Ajustes: duración por defecto, hasta 6 tramos (filas vacías se ignoran) y las reglas de la reserva online. */
export const bookingSettingsSchema = z
  .record(z.string(), z.string())
  .transform((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    const num = (key: string, schema: z.ZodType<number>): number | null => {
      const r = schema.safeParse(v[key] ?? '');
      if (!r.success) {
        issue(key, r.error.issues[0]?.message ?? REQUIRED);
        return null;
      }
      return r.data;
    };
    const defaultDuration = num('defaultDuration', durationSchema);
    const minAdvanceMin = num('minAdvanceMin', intIn(0, 10080, 'De 0 a 10080 minutos (una semana).'));
    const maxAdvanceDays = num('maxAdvanceDays', intIn(1, 365, 'De 1 a 365 días.'));
    const maxOnlineParty = num('maxOnlineParty', intIn(1, 50, 'Entre 1 y 50 personas.'));
    const cancelLimitHours = num('cancelLimitHours', intIn(0, 168, 'De 0 a 168 horas (una semana).'));
    const rules: (DurationRule & { row: number })[] = [];
    for (const n of RULE_ROWS) {
      const keys = [`rule${n}_min`, `rule${n}_max`, `rule${n}_duration`];
      if (keys.every((k) => (v[k] ?? '').trim() === '')) continue;
      const minParty = num(keys[0], partySizeSchema);
      const maxParty = num(keys[1], partySizeSchema);
      const durationMin = num(keys[2], durationSchema);
      if (minParty === null || maxParty === null || durationMin === null) continue;
      if (minParty > maxParty) {
        issue(keys[1], 'El máximo no puede ser menor que el mínimo.');
        continue;
      }
      rules.push({ minParty, maxParty, durationMin, row: n });
    }
    const clash = overlappingRules(rules);
    if (clash) issue(`rule${rules[clash[1]].row}_min`, `Se solapa con el tramo ${rules[clash[0]].row}.`);
    if (defaultDuration === null || minAdvanceMin === null || maxAdvanceDays === null || maxOnlineParty === null || cancelLimitHours === null || clash) {
      return z.NEVER;
    }
    return {
      defaultDurationMin: defaultDuration,
      durationRules: rules.map(({ minParty, maxParty, durationMin }) => ({ minParty, maxParty, durationMin })),
      minAdvanceMin,
      maxAdvanceDays,
      maxOnlineParty,
      cancelLimitHours,
      autoConfirm: v.autoConfirm === 'on',
    };
  });

// Servicios: última hora de reserva e intervalo -----------------------------------------------------------------
/**
 * Campos del Hito 4A de un servicio (ya validadas sus horas): la última reserva (vacía = una hora antes del cierre)
 * tiene que caer dentro del servicio; si es anterior al inicio, es de después de medianoche.
 */
export function serviceBookingSchema(range: { startMinute: number; endMinute: number }) {
  return z
    .object({ lastBooking: z.string().trim(), slotInterval: z.string().trim() })
    .transform((v, ctx) => {
      let lastBookingMinute: number | null = null;
      if (v.lastBooking !== '') {
        const m = timeToMinutes(v.lastBooking);
        if (m === null) {
          ctx.addIssue({ code: 'custom', path: ['lastBooking'], message: BAD_TIME });
          return z.NEVER;
        }
        const minute = m < range.startMinute ? m + MINUTES_PER_DAY : m;
        if (minute >= range.endMinute) {
          ctx.addIssue({ code: 'custom', path: ['lastBooking'], message: 'La última reserva tiene que ser antes del cierre del servicio.' });
          return z.NEVER;
        }
        lastBookingMinute = minute;
      }
      if (v.slotInterval !== '15' && v.slotInterval !== '30') {
        ctx.addIssue({ code: 'custom', path: ['slotInterval'], message: 'Elige cada 15 o cada 30 minutos.' });
        return z.NEVER;
      }
      return { lastBookingMinute, slotIntervalMin: Number(v.slotInterval) as 15 | 30 };
    });
}

// Reservas ------------------------------------------------------------------------------------------------------
export const TABLE_MODES = ['auto', 'manual', 'none', 'keep'] as const;
export type TableMode = (typeof TABLE_MODES)[number];

/** Lo que llega de los formularios de reserva (los campos que falten llegan como ''). */
export function readReservationForm(fd: FormData) {
  return {
    ...formStrings(fd, ['date', 'time', 'partySize', 'duration', 'tableMode', 'name', 'phone', 'email', 'notes', 'internalNotes']),
    tableIds: fd.getAll('tableIds').filter((v): v is string => typeof v === 'string'),
  };
}

const reservationBase = {
  date: isoDateSchema,
  time: timeSchema,
  partySize: partySizeSchema,
  duration: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 15 && Number(v) <= 720 && Number(v) % 15 === 0), 'De 15 minutos a 12 horas, en pasos de 15 minutos.')
    .transform((v) => (v === '' ? null : Number(v))),
  tableMode: z.enum(TABLE_MODES, { error: 'Elige una mesa o guárdala sin mesa.' }),
  tableIds: z.array(z.string()),
  notes: optionalText(BOOKING_LIMITS.notes),
  internalNotes: optionalText(BOOKING_LIMITS.notes),
};

function checkTables(v: { tableMode: TableMode; tableIds: string[] }, ctx: z.RefinementCtx) {
  const ids = [...new Set(v.tableIds)];
  if (!ids.every((id) => uuidSchema.safeParse(id).success)) {
    ctx.addIssue({ code: 'custom', path: ['tableIds'], message: 'Elige las mesas de la lista.' });
  } else if ((v.tableMode === 'manual' || v.tableMode === 'keep') && ids.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['tableIds'], message: 'Elige al menos una mesa.' });
  } else if (ids.length > BOOKING_LIMITS.tablesPerReservation) {
    ctx.addIssue({ code: 'custom', path: ['tableIds'], message: `Como mucho ${BOOKING_LIMITS.tablesPerReservation} mesas por reserva.` });
  }
}

/** Nueva reserva por teléfono: con el cliente (teléfono obligatorio, normalizado a E.164). */
export const phoneReservationSchema = z
  .object({
    ...reservationBase,
    name: trimmed(120, 'El nombre puede tener como mucho 120 caracteres.').min(1, 'Escribe el nombre de quien reserva.'),
    phone: z
      .string({ error: REQUIRED })
      .trim()
      .min(1, 'Escribe un teléfono de contacto.')
      .transform((v, ctx) => {
        const phone = normalizePhoneE164(v);
        if (!phone) {
          ctx.addIssue({ code: 'custom', message: 'Ese teléfono no parece correcto. Si es de fuera, empieza por + y el prefijo.' });
          return z.NEVER;
        }
        return phone;
      }),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .transform((v, ctx) => {
        if (v === '') return null;
        if (!z.email().safeParse(v).success) {
          ctx.addIssue({ code: 'custom', message: 'Ese email no parece correcto.' });
          return z.NEVER;
        }
        return v;
      }),
  })
  .superRefine(checkTables)
  .refine((v) => v.tableMode !== 'keep', { path: ['tableMode'], message: 'Elige una mesa o guárdala sin mesa.' });

/** Cambiar una reserva: hora, personas, duración, mesas y notas (el cliente no cambia aquí). */
export const reservationEditSchema = z.object(reservationBase).superRefine(checkTables);

/** Walk-in: personas, una o varias mesas libres y el nombre si lo dan. */
export const walkInSchema = z
  .object({
    partySize: partySizeSchema,
    tableIds: z.array(z.string()),
    name: optionalText(120),
  })
  .superRefine((v, ctx) => checkTables({ tableMode: 'manual', tableIds: v.tableIds }, ctx));

// Bloqueos ------------------------------------------------------------------------------------------------------
/** Bloqueo de una mesa o de todo el restaurante en una franja de un día (si acaba antes de empezar, al día siguiente). */
export const blockFormSchema = z
  .object({
    date: isoDateSchema,
    start: z.string().trim(),
    end: z.string().trim(),
    allDay: checkbox,
    tableId: z.string().trim(),
    reason: optionalText(BOOKING_LIMITS.blockReason),
  })
  .transform((v, ctx) => {
    if (v.tableId !== '' && !uuidSchema.safeParse(v.tableId).success) {
      ctx.addIssue({ code: 'custom', path: ['tableId'], message: 'Elige una mesa de la lista.' });
      return z.NEVER;
    }
    let startMinute = 0;
    let endMinute = MINUTES_PER_DAY;
    if (!v.allDay) {
      const s = timeToMinutes(v.start);
      const e = timeToMinutes(v.end);
      if (s === null) ctx.addIssue({ code: 'custom', path: ['start'], message: BAD_TIME });
      if (e === null) ctx.addIssue({ code: 'custom', path: ['end'], message: BAD_TIME });
      if (s === null || e === null) return z.NEVER;
      if (s === e) {
        ctx.addIssue({ code: 'custom', path: ['end'], message: 'Tiene que acabar después de empezar.' });
        return z.NEVER;
      }
      startMinute = s;
      endMinute = e < s ? e + MINUTES_PER_DAY : e;
    }
    return { date: v.date, startMinute, endMinute, tableId: v.tableId === '' ? null : v.tableId, reason: v.reason };
  });

export const BLOCK_FORM_FIELDS = ['date', 'start', 'end', 'allDay', 'tableId', 'reason'] as const;

export const statusSchema = z.enum(RESERVATION_STATUSES);
