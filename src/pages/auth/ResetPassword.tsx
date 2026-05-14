import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle2 } from 'lucide-react';

const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [success, setSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const { updatePassword } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Detect recovery session — Supabase parses the recovery token from the URL hash
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsReady(true);
      }
    });

    // Also check existing session in case event fired before listener attached
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setIsReady(true);
      } else {
        // No recovery session and no auth event — link is invalid/expired
        setTimeout(() => {
          setLinkInvalid((prev) => prev || !isReady);
        }, 1500);
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: { password?: string; confirm?: string } = {};
    if (!password) errors.password = '請輸入新密碼';
    else if (password.length < 6) errors.password = '密碼至少需 6 個字元';
    if (!confirm) errors.confirm = '請再次輸入新密碼';
    else if (confirm !== password) errors.confirm = '兩次輸入的密碼不一致';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setIsLoading(true);
    const result = await updatePassword(password);
    setIsLoading(false);
    if (result.success) {
      setSuccess(true);
      // Sign out so the user must log in with the new password
      await supabase.auth.signOut();
      setTimeout(() => navigate('/auth/login', { replace: true }), 1800);
    } else {
      toast({ title: '更新密碼失敗', description: result.error, variant: 'destructive' });
    }
  };

  return (
    <PortalLayout>
      <SEO
        title="重設密碼 | 智富股市實戰學院"
        description="設定新的會員登入密碼。"
        path="/auth/reset-password"
        noindex
      />
      <div className="container py-12 md:py-20">
        <div className="max-w-md mx-auto">
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">設定新密碼</CardTitle>
              <CardDescription>
                請輸入新的登入密碼
              </CardDescription>
            </CardHeader>
            <CardContent>
              {success ? (
                <div className="text-center space-y-4 py-4">
                  <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <CheckCircle2 className="h-6 w-6 text-primary" />
                  </div>
                  <p className="font-medium">密碼已更新</p>
                  <p className="text-sm text-muted-foreground">
                    即將為您導向登入頁面...
                  </p>
                </div>
              ) : linkInvalid && !isReady ? (
                <div className="text-center space-y-4 py-4">
                  <p className="font-medium">連結已失效</p>
                  <p className="text-sm text-muted-foreground">
                    此重設連結可能已過期或已被使用。請重新申請忘記密碼。
                  </p>
                  <Button asChild className="w-full">
                    <Link to="/auth/forgot-password">重新申請</Link>
                  </Button>
                </div>
              ) : !isReady ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="password">新密碼</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setFieldErrors((prev) => ({ ...prev, password: undefined })); }}
                      className={fieldErrors.password ? 'border-destructive' : ''}
                      required
                    />
                    {fieldErrors.password && <p className="text-xs text-destructive mt-1">{fieldErrors.password}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm">確認新密碼</Label>
                    <Input
                      id="confirm"
                      type="password"
                      placeholder="••••••••"
                      value={confirm}
                      onChange={(e) => { setConfirm(e.target.value); setFieldErrors((prev) => ({ ...prev, confirm: undefined })); }}
                      className={fieldErrors.confirm ? 'border-destructive' : ''}
                      required
                    />
                    {fieldErrors.confirm && <p className="text-xs text-destructive mt-1">{fieldErrors.confirm}</p>}
                  </div>

                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        更新中...
                      </>
                    ) : (
                      '更新密碼'
                    )}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PortalLayout>
  );
};

export default ResetPassword;
