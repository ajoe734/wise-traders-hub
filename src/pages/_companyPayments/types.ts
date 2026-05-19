export type ProviderType = 'acpay' | 'ecpay' | 'newebpay' | 'line_pay';

export interface ProviderRow {
  id: string;
  provider_type: ProviderType;
  display_name: string;
  is_active: boolean;
  is_default: boolean;
  config?: Record<string, unknown>;
  created_at?: string;
}

export type CredsStatus = 'complete' | 'missing' | 'unsupported';

export interface ChannelRow {
  provider: ProviderRow;
  credsStatus: CredsStatus;
  missingFields: string[];
  env?: 'stage' | 'production';
}

export type EcpayCredsRow = {
  merchant_id?: string;
  hash_key?: string;
  hash_iv?: string;
  credit_action_url?: string;
  api_url?: string;
  env?: 'stage' | 'production';
  updated_at?: string;
};

export const providerLabels: Record<ProviderType, string> = {
  acpay: 'ACpay',
  ecpay: '綠界 ECPay',
  newebpay: '藍新 NewebPay',
  line_pay: 'LINE Pay',
};

export const REMIT_FIELDS: { key: string; label: string; placeholder?: string }[] = [
  { key: 'bank_name', label: '銀行名稱', placeholder: '例：玉山銀行' },
  { key: 'bank_code', label: '銀行代碼', placeholder: '例：808' },
  { key: 'account_number', label: '帳號' },
  { key: 'account_name', label: '戶名' },
];
