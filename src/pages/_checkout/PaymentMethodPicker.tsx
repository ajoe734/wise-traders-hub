import { RefObject } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CreditCard, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PaymentProvider {
  id: string;
  display_name: string;
  provider_type: string;
}

interface PaymentMethodPickerProps {
  providers: PaymentProvider[];
  selectedProvider: string | null;
  setSelectedProvider: (id: string) => void;
  isAdvisor: boolean;
  isAcpay: boolean;
  acpayCardRef: RefObject<HTMLDivElement>;
  cardHolderName: string;
  setCardHolderName: (v: string) => void;
  cardHolderEmail: string;
  setCardHolderEmail: (v: string) => void;
  cardHolderPhone: string;
  setCardHolderPhone: (v: string) => void;
  countryCode: string;
  setCountryCode: (v: string) => void;
  cardFieldErrors: { name?: string; email?: string; phone?: string };
  setCardFieldErrors: (fn: (prev: { name?: string; email?: string; phone?: string }) => { name?: string; email?: string; phone?: string }) => void;
}

function getProviderIcon(providerType: string): string {
  switch (providerType) {
    case 'acpay': return '💳';
    case 'ecpay': return '🏦';
    case 'line_pay': return '💚';
    case 'newebpay': return '🔵';
    default: return '💳';
  }
}

export function PaymentMethodPicker({
  providers,
  selectedProvider,
  setSelectedProvider,
  isAdvisor,
  isAcpay,
  acpayCardRef,
  cardHolderName,
  setCardHolderName,
  cardHolderEmail,
  setCardHolderEmail,
  cardHolderPhone,
  setCardHolderPhone,
  countryCode,
  setCountryCode,
  cardFieldErrors,
  setCardFieldErrors,
}: PaymentMethodPickerProps) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">選擇付款方式</CardTitle>
          <p className="text-xs text-muted-foreground">🧪 目前為沙盒測試模式</p>
        </CardHeader>
        <CardContent>
          {providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚未設定可用的付款方式</p>
          ) : (
            <div className="space-y-3">
              {providers.map(provider => (
                <button
                  key={provider.id}
                  onClick={() => setSelectedProvider(provider.id)}
                  className={cn(
                    "w-full flex items-center gap-4 p-4 rounded-lg border-2 text-left transition-colors",
                    selectedProvider === provider.id
                      ? isAdvisor ? "border-primary bg-primary/5" : "border-mentor bg-mentor-light/30"
                      : isAdvisor ? "border-border hover:border-primary/50" : "border-border hover:border-mentor/50"
                  )}
                >
                  <span className="text-2xl">{getProviderIcon(provider.provider_type)}</span>
                  <div className="flex-1">
                    <p className="font-semibold">{provider.display_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {provider.provider_type === 'acpay' && '信用卡付款'}
                      {provider.provider_type === 'ecpay' && '信用卡'}
                      {provider.provider_type === 'line_pay' && 'LINE Pay 行動支付'}
                      {provider.provider_type === 'newebpay' && '信用卡 / WebATM'}
                    </p>
                  </div>
                  <div className={cn(
                    "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                    selectedProvider === provider.id
                      ? isAdvisor ? "border-primary bg-primary" : "border-mentor bg-mentor"
                      : "border-muted-foreground/30"
                  )}>
                    {selectedProvider === provider.id && (
                      <Check className="h-3 w-3 text-primary-foreground" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {isAcpay && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">信用卡資訊</h3>
            </div>

            <div ref={acpayCardRef} className="space-y-3">
              <div>
                <Label htmlFor="portal-acpay-card-number" className="text-xs text-muted-foreground">卡號</Label>
                <div id="portal-acpay-card-number" className="h-10 border rounded-md border-input bg-background px-3 py-2" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="portal-acpay-expiry" className="text-xs text-muted-foreground">有效日期</Label>
                  <div id="portal-acpay-expiry" className="h-10 border rounded-md border-input bg-background px-3 py-2" />
                </div>
                <div>
                  <Label htmlFor="portal-acpay-ccv" className="text-xs text-muted-foreground">安全碼</Label>
                  <div id="portal-acpay-ccv" className="h-10 border rounded-md border-input bg-background px-3 py-2" />
                </div>
              </div>
            </div>

            <div className="border-t pt-4 space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground">持卡人資訊</h4>
              <div>
                <Label htmlFor="portal-card-holder-name" className="text-xs text-muted-foreground">英文姓名（如卡片上所示）</Label>
                <Input
                  id="portal-card-holder-name"
                  value={cardHolderName}
                  onChange={(e) => { setCardHolderName(e.target.value); setCardFieldErrors(prev => ({ ...prev, name: undefined })); }}
                  placeholder="WANG DA MING"
                  className={`mt-1 ${cardFieldErrors.name ? 'border-destructive' : ''}`}
                />
                {cardFieldErrors.name && <p className="text-xs text-destructive mt-1">{cardFieldErrors.name}</p>}
              </div>
              <div>
                <Label htmlFor="portal-card-holder-email" className="text-xs text-muted-foreground">電子郵件</Label>
                <Input
                  id="portal-card-holder-email"
                  type="email"
                  value={cardHolderEmail}
                  onChange={(e) => { setCardHolderEmail(e.target.value); setCardFieldErrors(prev => ({ ...prev, email: undefined })); }}
                  placeholder="example@mail.com"
                  className={`mt-1 ${cardFieldErrors.email ? 'border-destructive' : ''}`}
                />
                {cardFieldErrors.email && <p className="text-xs text-destructive mt-1">{cardFieldErrors.email}</p>}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label htmlFor="portal-country-code" className="text-xs text-muted-foreground">國碼</Label>
                  <Input
                    id="portal-country-code"
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    placeholder="886"
                    className="mt-1"
                  />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="portal-card-holder-phone" className="text-xs text-muted-foreground">手機號碼（去掉前綴 0）</Label>
                  <Input
                    id="portal-card-holder-phone"
                    value={cardHolderPhone}
                    onChange={(e) => { setCardHolderPhone(e.target.value); setCardFieldErrors(prev => ({ ...prev, phone: undefined })); }}
                    placeholder="912345678"
                    className={`mt-1 ${cardFieldErrors.phone ? 'border-destructive' : ''}`}
                  />
                  {cardFieldErrors.phone && <p className="text-xs text-destructive mt-1">{cardFieldErrors.phone}</p>}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
