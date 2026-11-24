import 'server-only';
import { ROLE_LABELS, type Role } from '@/lib/permissions';
import { sendEmail, type SendResult } from './send';
import { InvitationEmail, invitationSubject } from './templates/InvitationEmail';

export function sendInvitationEmail(input: {
  to: string;
  restaurantName: string;
  role: Role;
  inviteUrl: string;
}): Promise<SendResult> {
  return sendEmail({
    to: input.to,
    subject: invitationSubject(input.restaurantName),
    react: InvitationEmail({
      restaurantName: input.restaurantName,
      roleLabel: ROLE_LABELS[input.role],
      inviteUrl: input.inviteUrl,
    }),
  });
}
