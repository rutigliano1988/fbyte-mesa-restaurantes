import 'server-only';
import { siteUrl } from '@/lib/env';

export function invitationUrl(token: string): string {
  return `${siteUrl()}/invitacion/${token}`;
}
