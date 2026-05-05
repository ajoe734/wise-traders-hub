import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { User, MessageCircle, Loader2, Camera } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { updateProfileFields } from '@/lib/profileFieldGuard';

const AccountProfile = () => {
  const { user, isAuthenticated, logout, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith('image/')) {
      toast.error('請選擇圖片檔案');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('檔案大小不可超過 5MB');
      return;
    }

    setIsUploading(true);
    const oldUrl = user.avatarUrl;
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const rand = Math.random().toString(36).slice(2, 8);
      const filePath = `${user.id}/avatar-${Date.now()}-${rand}.${ext}`;

      // 唯一檔名 → 不使用 upsert，避免觸發 update 路徑的 Storage RLS
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: false, contentType: file.type });

      if (uploadError) throw new Error('上傳檔案失敗：' + uploadError.message);

      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);
      const avatarUrl = urlData.publicUrl;

      const { error: updateError } = await updateProfileFields(supabase, user.id, { avatar_url: avatarUrl });
      if (updateError) throw new Error('更新資料失敗：' + updateError);

      // best-effort：刪除舊檔
      if (oldUrl && oldUrl.includes('/avatars/')) {
        try {
          const oldPath = oldUrl.split('/avatars/')[1]?.split('?')[0];
          if (oldPath && oldPath !== filePath) {
            await supabase.storage.from('avatars').remove([oldPath]);
          }
        } catch { /* ignore */ }
      }

      await refreshProfile();
      toast.success('頭貼已更新');
    } catch (err: any) {
      console.error('Avatar upload error:', err);
      toast.error(err.message || '上傳失敗');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);
    const { error: errMsg } = await updateProfileFields(supabase, user.id, { display_name: displayName });
    setIsSaving(false);
    if (errMsg) {
      toast.error('儲存失敗：' + errMsg);
    } else {
      await refreshProfile();
      toast.success('已儲存');
    }
  };

  if (!isAuthenticated || !user) {
    return (
      <PortalLayout>
        <div className="container py-12 text-center">
          <h1 className="text-2xl font-bold mb-4">請先登入</h1>
          <Button asChild>
            <Link to="/auth/login">前往登入</Link>
          </Button>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout hideHeader>
      <div className="container py-8 md:py-12 max-w-2xl">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-2">個人資料</h1>
          <p className="text-muted-foreground">管理你的帳號設定</p>
        </div>

        <div className="space-y-6">
          {/* Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="h-5 w-5" />
                基本資料
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Avatar Upload */}
              <div className="flex items-center gap-4">
                <div className="relative group">
                  <div className="h-20 w-20 rounded-full overflow-hidden bg-muted flex items-center justify-center">
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt="頭貼" className="h-full w-full object-cover" />
                    ) : (
                      <User className="h-8 w-8 text-muted-foreground" />
                    )}
                  </div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                  >
                    {isUploading ? (
                      <Loader2 className="h-5 w-5 text-white animate-spin" />
                    ) : (
                      <Camera className="h-5 w-5 text-white" />
                    )}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className="hidden"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium">大頭貼</p>
                  <p className="text-xs text-muted-foreground">點擊頭像上傳，支援 JPG、PNG（最大 5MB）</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">姓名</Label>
                <Input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" defaultValue={user.email} disabled />
                <p className="text-xs text-muted-foreground">Email 無法修改</p>
              </div>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                儲存變更
              </Button>
            </CardContent>
          </Card>

          {/* LINE Connection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                LINE 綁定
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                <div>
                  <p className="font-medium">LINE 帳號</p>
                  <p className="text-sm text-muted-foreground">尚未綁定</p>
                </div>
                <Button variant="outline" disabled>
                  綁定 LINE（即將開放）
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                綁定後可透過 LINE 接收即時訊號通知
              </p>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex flex-wrap gap-4">
            <Button variant="outline" asChild>
              <Link to="/account/subscriptions">查看訂閱</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/account/notifications">提醒中心</Link>
            </Button>
            <Button variant="destructive" onClick={logout}>
              登出
            </Button>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
};

export default AccountProfile;
