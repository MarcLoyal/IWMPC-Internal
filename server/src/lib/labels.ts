import type { PaymentType } from '@prisma/client';

export const PAYMENT_TYPE_LABEL: Record<PaymentType, string> = {
  WATER_BILL: 'Water Bill',
  INSTALLATION_FEE: 'Installation Fee',
  MEMBERSHIP_FEE: 'Membership Fee',
  SHARE_CAPITAL: 'Share Capital',
  RICE_LPG: 'Rice & LPG',
  OTHER: 'Other',
};
