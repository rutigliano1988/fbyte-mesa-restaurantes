const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const CIF_LETTERS = 'JABCDEFGHI';

/** ' b-12.345.674 ' → 'B12345674'. */
export function normalizeTaxId(input: string): string {
  return input.toUpperCase().replace(/[\s.-]/g, '');
}

function cifControlOk(type: string, digits: string, control: string): boolean {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const d = Number(digits[i]);
    if (i % 2 === 0) {
      const doubled = d * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    } else {
      sum += d;
    }
  }
  const digit = (10 - (sum % 10)) % 10;
  const letter = CIF_LETTERS[digit];
  if ('PQRSNW'.includes(type)) return control === letter;
  if ('ABEH'.includes(type)) return control === String(digit);
  return control === String(digit) || control === letter;
}

/** NIF (DNI), NIE (X/Y/Z), NIF especiales (K/L/M) y CIF, con su dígito o letra de control. */
export function isValidTaxId(input: string): boolean {
  const v = normalizeTaxId(input);
  let m: RegExpExecArray | null;
  if ((m = /^(\d{8})([A-Z])$/.exec(v))) return DNI_LETTERS[Number(m[1]) % 23] === m[2];
  if ((m = /^([XYZ])(\d{7})([A-Z])$/.exec(v))) return DNI_LETTERS[Number(`${'XYZ'.indexOf(m[1])}${m[2]}`) % 23] === m[3];
  if ((m = /^([KLM])(\d{7})([A-Z])$/.exec(v))) return DNI_LETTERS[Number(m[2]) % 23] === m[3];
  if ((m = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(v))) return cifControlOk(m[1], m[2], m[3]);
  return false;
}

/** 5 cifras y una provincia que existe (01–52). */
export function isValidPostalCode(input: string): boolean {
  return /^(0[1-9]|[1-4]\d|5[0-2])\d{3}$/.test(input.trim());
}

/** Quita espacios, puntos, guiones y paréntesis; '0034…' → '+34…'. */
export function normalizePhone(input: string): string {
  const v = input.trim().replace(/[\s.()-]/g, '');
  return v.startsWith('00') ? `+${v.slice(2)}` : v;
}

export function isValidPhone(input: string): boolean {
  return /^\+?\d{9,15}$/.test(normalizePhone(input));
}

/** '910000000' → '910 000 000'; '+34910000000' → '+34 910 000 000'. */
export function formatPhone(phone: string): string {
  const m = /^(\+34)?(\d{3})(\d{3})(\d{3})$/.exec(phone);
  if (!m) return phone;
  return `${m[1] ? `${m[1]} ` : ''}${m[2]} ${m[3]} ${m[4]}`;
}
