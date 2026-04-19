import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Loader2, MessageCircle } from 'lucide-react';

const Register = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({
        title: '密碼不一致',
        description: '請確認兩次輸入的密碼相同',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);

    const result = await register(email, password, name);

    if (result.success) {
      toast({
        title: '註冊成功',
        description: '歡迎加入！',
      });
      navigate('/app');
    } else {
      toast({
        title: '註冊失敗',
        description: result.error,
        variant: 'destructive',
      });
    }

    setIsLoading(false);
  };

  const handleLineLogin = () => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const callbackUrl = `${supabaseUrl}/functions/v1/line-login-callback`;
    const returnTo = '/app';
    sessionStorage.setItem('line_login_return_to', returnTo);
    const appOrigin = window.location.origin;
    const authorizeUrl = `${supabaseUrl}/functions/v1/line-login-authorize?redirect_uri=${encodeURIComponent(callbackUrl)}&return_to=${encodeURIComponent(returnTo)}&app_origin=${encodeURIComponent(appOrigin)}`;
    window.location.href = authorizeUrl;
  };

  return (
    <PortalLayout>
      <div className="container py-12 md:py-20">
        <div className="max-w-md mx-auto">
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">免費註冊</CardTitle>
              <CardDescription>
                建立帳號以開始使用投顧訂閱服務
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">姓名</Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="您的姓名"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">電子郵件</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">密碼</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="至少 8 位，避免使用常見密碼"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">確認密碼</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="再次輸入密碼"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      註冊中...
                    </>
                  ) : (
                    '建立帳號'
                  )}
                </Button>
              </form>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">或</span>
                </div>
              </div>

              <Button 
                type="button" 
                variant="outline" 
                className="w-full bg-[#06C755]/10 border-[#06C755]/30 text-[#06C755] hover:bg-[#06C755]/20 hover:border-[#06C755]/50"
                onClick={handleLineLogin}
              >
                <MessageCircle className="h-4 w-4 mr-2" />
                使用 LINE 快速登入
              </Button>

              <p className="text-center text-sm text-muted-foreground mt-6">
                已經有帳號？{' '}
                <Link to="/auth/login" className="text-primary hover:underline">
                  登入
                </Link>
              </p>

              <p className="text-center text-xs text-muted-foreground mt-4">
                註冊即表示您同意我們的{' '}
                <Link to="/legal" className="underline">服務條款</Link>
                {' '}和{' '}
                <Link to="/legal" className="underline">隱私政策</Link>
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </PortalLayout>
  );
};

export default Register;
