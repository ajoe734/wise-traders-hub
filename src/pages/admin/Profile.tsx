import { SEO } from '@/components/SEO';
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Save, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PermissionTooltip } from '@/components/admin/PermissionTooltip';
import { useAdminProfile } from '@/hooks/admin/useAdminProfile';
import AvatarCard from '@/pages/_adminProfile/AvatarCard';
import BasicInfoCard from '@/pages/_adminProfile/BasicInfoCard';
import StyleMarketCard from '@/pages/_adminProfile/StyleMarketCard';
import StrategyKpiCard from '@/pages/_adminProfile/StrategyKpiCard';
import StartingCapitalCard from '@/pages/_adminProfile/StartingCapitalCard';
import CurrencyCard from '@/pages/_adminProfile/CurrencyCard';
import { resolveAssetClass, getAssetSpec, type AssetClass } from '@/lib/asset';
import PasswordChangeCard from '@/pages/_adminProfile/PasswordChangeCard';
import AiIndexCard from '@/pages/_adminProfile/AiIndexCard';

const AdminProfile = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const { user, hasRole } = useAuth();
  const isCompanyAdmin = hasRole('company_admin');
  const isOwner = !!user?.expertSlug && user.expertSlug === expertSlug;
  // company_admin 擁有最高權限，可代為編輯任一分析師個人檔案
  const isReadOnly = !isCompanyAdmin && !isOwner;

  const {
    expert, isLoading, capitalStatus, perf,
    saveProfile, setStartingCapital: setStartingCapitalMut, uploadAvatar,
    resetAssetClass,
  } = useAdminProfile(expertSlug, {
    isOwner,
    isCompanyAdmin,
    currentUserId: user?.id,
  });

  // 已發布訊號數（>0 → 幣別鎖定）
  const { data: publishedSignalCount } = useQuery({
    queryKey: ['admin', 'profile', 'published-signal-count', expert?.id],
    enabled: !!expert?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('expert_signals')
        .select('id', { count: 'exact', head: true })
        .eq('expert_id', expert!.id);
      if (error) throw error;
      return count ?? 0;
    },
  });
  const currencyLocked = (publishedSignalCount ?? 0) > 0;


  // Form state（元件層持有，hook 只管 query/mutation）
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [description, setDescription] = useState('');
  const [strategySummary, setStrategySummary] = useState('');
  const [strategyName, setStrategyName] = useState('');
  const [riskPreference, setRiskPreference] = useState('');
  const [operationCycle, setOperationCycle] = useState('');
  const [styleTags, setStyleTags] = useState<string[]>([]);
  const [markets, setMarkets] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [newMarket, setNewMarket] = useState('');
  const [assetClass, setAssetClass] = useState<AssetClass>('tw_stock');
  const currency = getAssetSpec(assetClass).currency;
  const [startingCapital, setStartingCapital] = useState<string>('');
  const [startingCapitalLocked, setStartingCapitalLocked] = useState(false);
  const [showCapitalConfirm, setShowCapitalConfirm] = useState(false);
  const [pendingCapital, setPendingCapital] = useState<number>(0);

  // Sync form state when expert data loads / changes
  useEffect(() => {
    if (!expert) return;
    setName(expert.name || '');
    setBio(expert.bio || '');
    setDescription(expert.description || '');
    setStrategySummary((expert as any).strategy_summary || '');
    setStrategyName((expert as any).strategy_name || '');
    setRiskPreference((expert as any).risk_preference || '');
    setOperationCycle((expert as any).operation_cycle || '');
    setStyleTags(expert.style_tags || []);
    setMarkets(expert.markets || []);
    setAssetClass(resolveAssetClass(expert as any));
    if (expert.starting_capital != null) {
      setStartingCapital(String(expert.starting_capital));
      setStartingCapitalLocked(true);
    } else {
      setStartingCapital('');
      setStartingCapitalLocked(false);
    }
  }, [expert]);

  const handleSave = () => {
    saveProfile.mutate({
      name,
      bio,
      description,
      strategy_summary: strategySummary,
      strategy_name: strategyName || null,
      risk_preference: riskPreference || null,
      operation_cycle: operationCycle || null,
      style_tags: styleTags,
      markets,
      currency,
      asset_class: assetClass,
    });
  };

  const handleAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadAvatar.mutateAsync(file);
    } finally {
      e.target.value = '';
    }
  };

  if (isLoading) return <AdminLayout><div className="flex items-center justify-center h-64 text-muted-foreground">載入中...</div></AdminLayout>;
  if (!expert) return <AdminLayout><div /></AdminLayout>;

  const isAdvisor = expert.role === 'advisor';
  const saving = saveProfile.isPending;
  const uploading = uploadAvatar.isPending;

  return (
    <AdminLayout>
      <SEO title={`${expertSlug || ''} 專家檔案 | legendflow`} description={'維護專家個人檔案與簡介。'} path={`/admin/${expertSlug || ''}/profile`} noindex />
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">個人檔案</h1>
            <p className="text-muted-foreground text-sm mt-1">編輯您的公開資訊</p>
          </div>
          <PermissionTooltip disabled={isReadOnly}>
            <Button
              onClick={handleSave}
              disabled={saving || isReadOnly}
              className={cn(isAdvisor ? 'bg-advisor hover:bg-advisor/90' : 'bg-mentor hover:bg-mentor/90')}
            >
              <Save className="h-4 w-4 mr-2" />
              {saving ? '儲存中...' : '儲存變更'}
            </Button>
          </PermissionTooltip>
        </div>

        <AvatarCard expert={expert} isReadOnly={isReadOnly} uploading={uploading} onPick={handleAvatarPick} />

        <BasicInfoCard
          name={name} bio={bio} description={description}
          isAdvisor={isAdvisor} isReadOnly={isReadOnly}
          setName={setName} setBio={setBio} setDescription={setDescription}
        />

        <StyleMarketCard
          styleTags={styleTags} markets={markets}
          newTag={newTag} newMarket={newMarket}
          isReadOnly={isReadOnly}
          setStyleTags={setStyleTags} setMarkets={setMarkets}
          setNewTag={setNewTag} setNewMarket={setNewMarket}
        />

        <StrategyKpiCard
          strategyName={strategyName} riskPreference={riskPreference}
          operationCycle={operationCycle} strategySummary={strategySummary}
          perf={perf} isReadOnly={isReadOnly}
          setStrategyName={setStrategyName}
          setRiskPreference={setRiskPreference}
          setOperationCycle={setOperationCycle}
          setStrategySummary={setStrategySummary}
        />

        <CurrencyCard
          assetClass={assetClass}
          setAssetClass={setAssetClass}
          isReadOnly={isReadOnly}
          locked={currencyLocked}
        />

        <StartingCapitalCard
          startingCapital={startingCapital}
          startingCapitalLocked={startingCapitalLocked}
          capitalStatus={capitalStatus}
          isReadOnly={isReadOnly}
          currency={currency}
          setStartingCapital={setStartingCapital}
          onRequestConfirm={(amount) => {
            setPendingCapital(amount);
            setShowCapitalConfirm(true);
          }}
        />

        <AlertDialog open={showCapitalConfirm} onOpenChange={setShowCapitalConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                確認起始資金
              </AlertDialogTitle>
              <AlertDialogDescription>
                您即將設定起始資金為 <strong>{currency === 'USD' ? 'US$' : 'NT$'} {pendingCapital.toLocaleString()}</strong>。
                <br /><br />
                <span className="text-destructive font-medium">起始資金設定後將無法更改，請確認金額正確。</span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={async () => {
                try {
                  await setStartingCapitalMut.mutateAsync(pendingCapital);
                  setStartingCapitalLocked(true);
                } catch { /* toast handled in hook */ }
              }}>
                確認設定
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AiIndexCard expertId={expert.id} expertName={expert.name} isReadOnly={isReadOnly} />

        {!isReadOnly && <PasswordChangeCard />}
      </div>
    </AdminLayout>
  );
};

export default AdminProfile;
