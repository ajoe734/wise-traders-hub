import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export default function PasswordChangeCard() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleChange = async () => {
    if (newPassword.length < 6) { toast.error('密碼至少 6 位'); return; }
    if (newPassword !== confirmPassword) { toast.error('兩次密碼不一致'); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);
    if (error) { toast.error('修改失敗：' + error.message); return; }
    toast.success('密碼已更新');
    setNewPassword('');
    setConfirmPassword('');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">修改密碼</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4 max-w-sm">
          <div className="space-y-2">
            <Label>新密碼</Label>
            <div className="relative">
              <Input type={showNew ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="至少 6 位" className="pr-10" />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowNew(!showNew)}>
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>確認新密碼</Label>
            <div className="relative">
              <Input type={showConfirm ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="再次輸入" className="pr-10" />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowConfirm(!showConfirm)}>
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <Button onClick={handleChange} disabled={saving} size="sm">
            {saving ? '更新中...' : '更新密碼'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
