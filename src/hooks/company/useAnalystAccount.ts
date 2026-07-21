import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { describeFunctionFailure, formatFailure, type FunctionFailure } from '@/lib/functionError';

interface ExpertLike { id: string; name: string }

export function useAnalystAccount() {
  const [acctExpert, setAcctExpert] = useState<ExpertLike | null>(null);
  const [acctTab, setAcctTab] = useState<'email' | 'password' | 'reset'>('email');
  const [acctCurrentEmail, setAcctCurrentEmail] = useState('');
  const [acctIsLineVirtual, setAcctIsLineVirtual] = useState(false);
  const [acctLoading, setAcctLoading] = useState(false);
  const [acctNewEmail, setAcctNewEmail] = useState('');
  const [acctNewPassword, setAcctNewPassword] = useState('');
  const [acctConfirmPassword, setAcctConfirmPassword] = useState('');
  const [acctSubmitting, setAcctSubmitting] = useState(false);
  const [acctError, setAcctError] = useState<FunctionFailure | null>(null);

  const openAccountDialog = async (exp: ExpertLike) => {
    setAcctExpert({ id: exp.id, name: exp.name });
    setAcctTab('email');
    setAcctNewEmail('');
    setAcctNewPassword('');
    setAcctConfirmPassword('');
    setAcctCurrentEmail('');
    setAcctIsLineVirtual(false);
    setAcctError(null);
    setAcctLoading(true);
    const { data, error } = await supabase.functions.invoke('update-analyst-credentials', {
      body: { expert_id: exp.id, action: 'fetch_email' },
    });
    setAcctLoading(false);
    const failure = await describeFunctionFailure(data, error, '無法讀取帳號資訊');
    if (failure) {
      setAcctError(failure);
      toast.error(formatFailure(failure, '無法讀取帳號資訊'));
      return;
    }
    setAcctCurrentEmail(data.email || '');
    setAcctIsLineVirtual(!!data.is_line_virtual);
    setAcctNewEmail(data.email || '');
  };

  const closeAccountDialog = () => {
    setAcctExpert(null);
    setAcctNewEmail('');
    setAcctNewPassword('');
    setAcctConfirmPassword('');
    setAcctError(null);
  };

  const handleUpdateEmail = async () => {
    if (!acctExpert) return;
    if (!acctNewEmail || acctNewEmail === acctCurrentEmail) {
      toast.error('請輸入新的 Email');
      return;
    }
    setAcctError(null);
    setAcctSubmitting(true);
    const { data, error } = await supabase.functions.invoke('update-analyst-credentials', {
      body: { expert_id: acctExpert.id, action: 'update_email', email: acctNewEmail.trim() },
    });
    setAcctSubmitting(false);
    const failure = await describeFunctionFailure(data, error, '更新失敗');
    if (failure) {
      setAcctError(failure);
      toast.error(formatFailure(failure, '更新失敗'));
      return;
    }
    toast.success('Email 已更新');
    setAcctCurrentEmail(data.email);
  };

  const handleResetPassword = async () => {
    if (!acctExpert) return;
    if (!acctNewPassword || acctNewPassword.length < 8) {
      toast.error('密碼至少 8 碼');
      return;
    }
    if (!/[A-Za-z]/.test(acctNewPassword) || !/[0-9]/.test(acctNewPassword)) {
      toast.error('密碼需包含英文字母與數字');
      return;
    }
    if (acctNewPassword !== acctConfirmPassword) {
      toast.error('兩次密碼輸入不一致');
      return;
    }
    if (!confirm(`確定要將 ${acctExpert.name} 的密碼重設為新密碼？此動作會立即生效。`)) return;
    setAcctError(null);
    setAcctSubmitting(true);
    const { data, error } = await supabase.functions.invoke('update-analyst-credentials', {
      body: { expert_id: acctExpert.id, action: 'reset_password', new_password: acctNewPassword },
    });
    setAcctSubmitting(false);
    const failure = await describeFunctionFailure(data, error, '重設失敗');
    if (failure) {
      setAcctError(failure);
      toast.error(formatFailure(failure, '重設失敗'));
      return;
    }
    toast.success('密碼已重設');
    setAcctNewPassword('');
    setAcctConfirmPassword('');
  };

  const handleSendResetEmail = async () => {
    if (!acctExpert) return;
    if (!confirm(`寄送密碼重設信至 ${acctCurrentEmail}？`)) return;
    setAcctError(null);
    setAcctSubmitting(true);
    const { data, error } = await supabase.functions.invoke('update-analyst-credentials', {
      body: { expert_id: acctExpert.id, action: 'send_reset_email' },
    });
    setAcctSubmitting(false);
    const failure = await describeFunctionFailure(data, error, '寄送失敗');
    if (failure) {
      setAcctError(failure);
      toast.error(formatFailure(failure, '寄送失敗'));
      return;
    }
    toast.success(`已寄送至 ${data.sent_to}`);
  };

  return {
    acctExpert, acctTab, setAcctTab,
    acctCurrentEmail, acctIsLineVirtual, acctLoading, acctError,
    acctNewEmail, setAcctNewEmail,
    acctNewPassword, setAcctNewPassword,
    acctConfirmPassword, setAcctConfirmPassword,
    acctSubmitting,
    openAccountDialog, closeAccountDialog,
    handleUpdateEmail, handleResetPassword, handleSendResetEmail,
  };
}
