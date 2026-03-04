import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Save, Upload, X, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const AdminProfile = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const { hasRole } = useAuth();
  const isReadOnly = hasRole('company_admin');

  const [expert, setExpert] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [description, setDescription] = useState('');
  const [styleTags, setStyleTags] = useState<string[]>([]);
  const [markets, setMarkets] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [newMarket, setNewMarket] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => { fetchExpert(); }, [expertSlug]);

  const fetchExpert = async () => {
    if (!expertSlug) return;
    setLoading(true);
    const { data } = await supabase.from('experts').select('*').eq('slug', expertSlug).single();
    if (data) {
      setExpert(data);
      setName(data.name || '');
      setBio(data.bio || '');
      setDescription(data.description || '');
      setStyleTags(data.style_tags || []);
      setMarkets(data.markets || []);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!expert) return;
    setSaving(true);
    const { error } = await supabase.from('experts').update({
      name,
      bio,
      description,
      style_tags: styleTags,
      markets,
    }).eq('id', expert.id);
    setSaving(false);
    if (error) { toast.error('儲存失敗：' + error.message); return; }
    toast.success('已儲存');
    setExpert({ ...expert, name, bio, description, style_tags: styleTags, markets });
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !expert) return;
    setUploading(true);

    const ext = file.name.split('.').pop();
    const path = `avatars/${expert.id}.${ext}`;

    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
    if (uploadError) {
      toast.error('上傳失敗：' + uploadError.message);
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
    const avatarUrl = urlData.publicUrl;

    const { error: updateError } = await supabase.from('experts').update({ avatar_url: avatarUrl }).eq('id', expert.id);
    if (updateError) { toast.error('更新頭像失敗'); }
    else {
      toast.success('頭像已更新');
      setExpert({ ...expert, avatar_url: avatarUrl });
    }
    setUploading(false);
  };

  const addTag = () => {
    if (newTag.trim() && !styleTags.includes(newTag.trim())) {
      setStyleTags([...styleTags, newTag.trim()]);
      setNewTag('');
    }
  };

  const addMarket = () => {
    if (newMarket.trim() && !markets.includes(newMarket.trim())) {
      setMarkets([...markets, newMarket.trim()]);
      setNewMarket('');
    }
  };

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-64 text-muted-foreground">載入中...</div></AdminLayout>;
  if (!expert) return <AdminLayout><div /></AdminLayout>;

  const isAdvisor = expert.role === 'advisor';

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">個人檔案</h1>
            <p className="text-muted-foreground text-sm mt-1">編輯您的公開資訊</p>
          </div>
          {!isReadOnly && (
            <Button
              onClick={handleSave}
              disabled={saving}
              className={cn(isAdvisor ? "bg-advisor hover:bg-advisor/90" : "bg-mentor hover:bg-mentor/90")}
            >
              <Save className="h-4 w-4 mr-2" />
              {saving ? '儲存中...' : '儲存變更'}
            </Button>
          )}
        </div>

        {/* Avatar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">頭像</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              <img
                src={expert.avatar_url || '/placeholder.svg'}
                alt={expert.name}
                className="h-20 w-20 rounded-full object-cover border-2 border-border"
              />
              <div>
                {!isReadOnly && (
                  <label>
                    <Button variant="outline" size="sm" asChild disabled={uploading}>
                      <span>
                        <Upload className="h-4 w-4 mr-2" />
                        {uploading ? '上傳中...' : '更換頭像'}
                      </span>
                    </Button>
                    <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                  </label>
                )}
                <p className="text-xs text-muted-foreground mt-2">建議尺寸 400x400px，JPG 或 PNG</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">基本資訊</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>姓名</Label>
                <Input value={name} onChange={e => setName(e.target.value)} disabled={isReadOnly} />
              </div>
              <div className="space-y-2">
                <Label>角色</Label>
                <div className="flex items-center h-9">
                  <Badge variant={isAdvisor ? 'advisor' : 'mentor'}>
                    {isAdvisor ? '投顧分析師' : '實戰導師'}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>簡介</Label>
              <Input value={bio} onChange={e => setBio(e.target.value)} disabled={isReadOnly} />
            </div>
            <div className="space-y-2">
              <Label>詳細介紹</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} disabled={isReadOnly} />
            </div>
          </CardContent>
        </Card>

        {/* Style & Market */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">風格與市場</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>風格標籤</Label>
              <div className="flex flex-wrap gap-2">
                {styleTags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    {tag}
                    {!isReadOnly && (
                      <X className="h-3 w-3 cursor-pointer" onClick={() => setStyleTags(styleTags.filter(t => t !== tag))} />
                    )}
                  </Badge>
                ))}
                {!isReadOnly && (
                  <div className="flex gap-1">
                    <Input
                      value={newTag}
                      onChange={e => setNewTag(e.target.value)}
                      placeholder="新標籤"
                      className="h-6 w-24 text-xs"
                      onKeyDown={e => e.key === 'Enter' && addTag()}
                    />
                    <Button variant="outline" size="sm" className="h-6 text-xs" onClick={addTag}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>交易市場</Label>
              <div className="flex flex-wrap gap-2">
                {markets.map((market) => (
                  <Badge key={market} variant="outline" className="gap-1">
                    {market}
                    {!isReadOnly && (
                      <X className="h-3 w-3 cursor-pointer" onClick={() => setMarkets(markets.filter(m => m !== market))} />
                    )}
                  </Badge>
                ))}
                {!isReadOnly && (
                  <div className="flex gap-1">
                    <Input
                      value={newMarket}
                      onChange={e => setNewMarket(e.target.value)}
                      placeholder="新市場"
                      className="h-6 w-24 text-xs"
                      onKeyDown={e => e.key === 'Enter' && addMarket()}
                    />
                    <Button variant="outline" size="sm" className="h-6 text-xs" onClick={addMarket}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Password Change */}
        {!isReadOnly && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">修改密碼</CardTitle>
            </CardHeader>
            <CardContent>
              <PasswordChangeForm />
            </CardContent>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
};

function PasswordChangeForm() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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
    <div className="space-y-4 max-w-sm">
      <div className="space-y-2">
        <Label>新密碼</Label>
        <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="至少 6 位" />
      </div>
      <div className="space-y-2">
        <Label>確認新密碼</Label>
        <Input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="再次輸入" />
      </div>
      <Button onClick={handleChange} disabled={saving} size="sm">
        {saving ? '更新中...' : '更新密碼'}
      </Button>
    </div>
  );
}

export default AdminProfile;
