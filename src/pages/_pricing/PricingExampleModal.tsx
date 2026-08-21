import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Radio, BookOpen, Clock, AlertCircle, Target, Lightbulb, ArrowRight } from 'lucide-react';

interface PricingExampleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeExample: 'follower' | 'cultivator' | null;
}

export function PricingExampleModal({ open, onOpenChange, activeExample }: PricingExampleModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {activeExample === 'follower' ? (
              <>
                <Radio className="h-5 w-5 text-advisor" />
                <span>跟單派範例</span>
              </>
            ) : (
              <>
                <BookOpen className="h-5 w-5 text-mentor" />
                <span>修煉派範例</span>
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {activeExample === 'follower' ? (
          <div className="space-y-6 mt-4">
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-3">訊號通知樣式</h4>
              <Card className="border-border">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <span>01/15 09:05</span>
                    </div>
                    <Badge variant="success-light" className="text-[10px]">即時</Badge>
                  </div>
                  <div className="flex items-center gap-3 mb-3">
                    <Badge variant="advisor" className="text-xs px-2 py-1">買進</Badge>
                    <span className="font-semibold text-lg">世芯-KY (3661.TW)</span>
                  </div>
                  <div className="text-sm mb-3">
                    <span className="text-muted-foreground">建議價位：</span>
                    <span className="font-medium text-advisor">約 185-190</span>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                    4有指標全亮，開盤跳空突破前高，量能爆發，鎖定漲停潛力股。
                  </p>
                  <div className="bg-warning-light/50 rounded-lg p-2.5 text-xs text-warning mb-3">
                    💡 當沖操作，必須盤中嚴格監控，收盤前務必出場...
                  </div>
                  <div className="flex items-center justify-end text-sm text-primary font-medium">
                    查看詳解與教學
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </div>
                </CardContent>
              </Card>
            </div>

            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-3">進出場紀錄 & 風控提示</h4>
              <Card className="bg-muted/30">
                <CardContent className="p-4 space-y-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium mb-2">
                      <AlertCircle className="h-4 w-4 text-warning" />
                      <span>風險提示</span>
                    </div>
                    <ul className="text-sm text-muted-foreground space-y-1.5 pl-6 list-disc">
                      <li>當沖操作，必須盤中嚴格監控，收盤前務必出場</li>
                      <li>若跌破開盤價 3%，立即停損出場</li>
                      <li>今日若大盤急跌 &gt; 1.5%，優先減碼保護資金</li>
                    </ul>
                  </div>

                  <div className="pt-3 border-t border-border">
                    <div className="flex items-center gap-2 text-sm font-medium mb-2">
                      <Target className="h-4 w-4 text-advisor" />
                      <span>倉位管理</span>
                    </div>
                    <ul className="text-sm text-muted-foreground space-y-1.5 pl-6 list-disc">
                      <li>本次進場為單筆資金的 100%（當沖不留倉）</li>
                      <li>第一目標價：漲停鎖定（+10%）</li>
                      <li>若無法攻上漲停，尾盤前 30 分鐘全數出場</li>
                    </ul>
                  </div>

                  <div className="pt-3 border-t border-border">
                    <div className="flex items-center gap-2 text-sm font-medium mb-2">
                      <Lightbulb className="h-4 w-4 text-primary" />
                      <span>學習重點</span>
                    </div>
                    <ul className="text-sm text-muted-foreground space-y-1.5 pl-6 list-disc">
                      <li>這筆示範「4有同步」的選股邏輯，四個指標同時確認</li>
                      <li>開盤5分鐘是判斷當日強弱的關鍵觀察期</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <div className="space-y-6 mt-4">
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-3">當週復盤樣式</h4>
              <Card className="border-border hover:border-mentor/30">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">01/06 ~ 01/12</span>
                    <Badge variant="mentor-light" className="text-[10px] ml-auto">
                      已公開週次
                    </Badge>
                  </div>
                  <h3 className="font-semibold mb-2">本週我怎麼看待漲停追價</h3>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                    這週大盤震盪加劇，我選擇只操作有明確籌碼支撐的標的，避開追高風險...
                  </p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                    <span className="flex items-center gap-1">
                      <BookOpen className="h-3.5 w-3.5" />
                      本週 8 筆操作
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <Badge variant="secondary" className="text-xs">量價配合判斷...</Badge>
                    <Badge variant="secondary" className="text-xs">停損紀律執行...</Badge>
                  </div>
                  <div className="flex items-center justify-end text-sm text-mentor font-medium">
                    查看本週詳細教學
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </div>
                </CardContent>
              </Card>
            </div>

            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-3">當週操作紀錄樣式</h4>
              <Card className="bg-muted/30">
                <CardContent className="p-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between py-2 border-b border-border">
                      <div className="flex items-center gap-3">
                        <Badge variant="mentor" className="text-[10px]">買進</Badge>
                        <span className="font-medium">台積電 (2330.TW)</span>
                      </div>
                      <Badge variant="outline" className="text-green-500 border-green-500/30 text-xs">漲停 +10%</Badge>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-border">
                      <div className="flex items-center gap-3">
                        <Badge variant="destructive" className="text-[10px]">停損</Badge>
                        <span className="font-medium">聯發科 (2454.TW)</span>
                      </div>
                      <Badge variant="outline" className="text-red-500 border-red-500/30 text-xs">-2.8%</Badge>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-border">
                      <div className="flex items-center gap-3">
                        <Badge variant="mentor" className="text-[10px]">買進</Badge>
                        <span className="font-medium">世芯-KY (3661.TW)</span>
                      </div>
                      <Badge variant="outline" className="text-green-500 border-green-500/30 text-xs">+6.5%</Badge>
                    </div>
                    <div className="pt-3 mt-2">
                      <div className="flex items-center gap-2 text-sm font-medium mb-2">
                        <Lightbulb className="h-4 w-4 text-mentor" />
                        <span>本週學習重點</span>
                      </div>
                      <ul className="text-sm text-muted-foreground space-y-1.5 pl-6 list-disc">
                        <li>量價配合是判斷進場時機的核心</li>
                        <li>停損紀律比獲利更重要</li>
                        <li>當沖必須在收盤前完全出場</li>
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
