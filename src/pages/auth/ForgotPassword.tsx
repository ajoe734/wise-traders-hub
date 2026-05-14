import { useState } from 'react';
import { SEO } from '@/components/SEO';
import { Link } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Loader2, MailCheck } from 'lucide-react';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const { requestPasswordReset } = useAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setFieldError('請輸入電子郵件');
      return;
    }
    setFieldError(undefined);
    setIsLoading(true);
    const result = await requestPasswordReset(email);
    setIsLoading(false);
    if (result.success) {
      setSent(true);
    } else {
      toast({ title: '無法寄送重設信', description: result.error, variant: 'destructive' });
    }
  };

  return (
    <PortalLayout>
      <SEO
        title="忘記密碼 | 智富股市實戰學院"
        description="輸入註冊電子郵件以接收密碼重設連結。"
        path="/auth/forgot-password"
        noindex
      />
      <div className="container py-12 md:py-20">
        <div className="max-w-md mx-auto">
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">忘記密碼</CardTitle>
              <CardDescription>
                輸入您的註冊信箱，我們會寄送重設密碼連結
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sent ? (
                <div className="text-center space-y-4 py-4">
                  <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <MailCheck className="h-6 w-6 text-primary" />
                  </div>
                  <div className="space-y-2">
                    <p className="font-medium">重設信已寄出</p>
                    <p className="text-sm text-muted-foreground">
                      如果 <span className="font-medium text-foreground">{email}</span> 為已註冊信箱，您將收到一封含重設連結的信件。
                    </p>
                    <p className="text-xs text-muted-foreground">
                      若未收到，請檢查垃圾信件匣，或稍後再試。
                    </p>
                  </div>
                  <Button asChild variant="outline" className="w-full">
                    <Link to="/auth/login">返回登入</Link>
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">電子郵件</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setFieldError(undefined); }}
                      className={fieldError ? 'border-destructive' : ''}
                      required
                    />
                    {fieldError && <p className="text-xs text-destructive mt-1">{fieldError}</p>}
                  </div>

                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        寄送中...
                      </>
                    ) : (
                      '寄送重設連結'
                    )}
                  </Button>

                  <p className="text-center text-sm text-muted-foreground mt-6">
                    想起密碼了？{' '}
                    <Link to="/auth/login" className="text-primary hover:underline">
                      返回登入
                    </Link>
                  </p>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PortalLayout>
  );
};

export default ForgotPassword;
