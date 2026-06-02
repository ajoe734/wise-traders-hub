import { useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useRevenueRefund(providerMap: Record<string, any>, onDone: () => void) {
  const { user } = useAuth();
  const [refundingTx, setRefundingTx] = useState<any>(null);
  const [refundReason, setRefundReason] = useState('');

  const close = () => { setRefundingTx(null); setRefundReason(''); };

  const handleRefund = async () => {
    if (!refundingTx) return;
    const tx = refundingTx.raw;
    const prov = providerMap[tx.provider_id];
    const providerType = prov?.provider_type;

    if (providerType === 'line_pay') {
      toast.error('LINE Pay 退款請至 LINE Pay 商家後台處理，本系統不支援自動退款');
      return;
    }

    if (!tx.subscription_id) {
      const ok = window.confirm('此筆交易未綁定訂閱（無法觸發金流商退款 API），是否僅更新本系統的退款狀態？');
      if (!ok) return;
      const { error } = await supabase.from('payment_transactions').update({ status: 'refunded' as any }).eq('id', tx.id);
      if (error) { toast.error(error.message); return; }
      await supabase.from('audit_logs').insert({
        action: 'payment.refund',
        actor_id: user?.id,
        target_type: 'payment_transactions',
        target_id: tx.id,
        detail: { reason: refundReason, amount: tx.amount, tx_id: tx.provider_tx_id, mode: 'db_only', context: { reason: refundReason, amount: tx.amount } },
      });
      toast.success('退款狀態已更新（未呼叫金流商）');
      close(); onDone();
      return;
    }

    const fnName = providerType === 'acpay' ? 'acpay-refund' : 'process-refund';
    const { data, error: fnErr } = await supabase.functions.invoke(fnName, {
      body: {
        subscription_id: tx.subscription_id,
        refund_amount: Math.abs(tx.amount || 0),
        original_amount: tx.original_amount || tx.amount,
        reason: refundReason || '管理員後台退款',
      },
    });

    if (fnErr || (data as any)?.error) {
      const msg = fnErr?.message || (data as any)?.error || '退款失敗';
      toast.error(`金流商退款失敗：${msg}`);
      await supabase.from('audit_logs').insert({
        action: 'payment.refund_failed',
        actor_id: user?.id,
        target_type: 'payment_transactions',
        target_id: tx.id,
        detail: { reason: refundReason, error: msg, provider: providerType, context: { reason: msg } },
      });
      return;
    }

    await supabase.from('audit_logs').insert({
      action: 'payment.refund',
      actor_id: user?.id,
      target_type: 'payment_transactions',
      target_id: tx.id,
      detail: { reason: refundReason, amount: tx.amount, tx_id: tx.provider_tx_id, provider: providerType, context: { reason: refundReason, amount: tx.amount } },
    });
    toast.success('退款完成（已呼叫金流商）');
    close(); onDone();
  };

  return { refundingTx, setRefundingTx, refundReason, setRefundReason, handleRefund, close };
}
