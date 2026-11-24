import { expect, it } from 'vitest';
import { parseOtpType } from './otp-type';

it.each(['recovery', 'invite', 'magiclink', 'email', 'signup', 'email_change'])('acepta %s', (t) => {
  expect(parseOtpType(t)).toBe(t);
});

it.each([null, '', 'sms', 'phone_change', 'RECOVERY', 'recovery '])('rechaza %j', (t) => {
  expect(parseOtpType(t)).toBeNull();
});
