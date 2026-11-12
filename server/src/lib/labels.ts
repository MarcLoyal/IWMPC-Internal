import type { PaymentType } from '@prisma/client';

export const PAYMENT_TYPE_LABEL: Record<PaymentType, string> = {
  INSTALLATION_FEE: 'Installation Fee',
  MEMBERSHIP_FEE: 'Membership Fee',
  SHARE_CAPITAL: 'Share Capital',
  OTHER: 'Other',
};
