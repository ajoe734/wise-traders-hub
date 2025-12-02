import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Bell, BellOff, Volume2, VolumeX, Flame, X } from 'lucide-react';
import { toast } from 'sonner';

interface SignalNotification {
  id: string;
  symbol: string;
  name: string;
  indicatorsActive: number;
  price: number;
  change: number;
  time: Date;
}

interface SignalNotificationSimulatorProps {
  className?: string;
}

// Mock signals for simulation
const mockSignals: Omit<SignalNotification, 'id' | 'time'>[] = [
  { symbol: '3443.TW', name: '創意', indicatorsActive: 4, price: 1450, change: 5.8 },
  { symbol: '6770.TW', name: '力積電', indicatorsActive: 4, price: 44.5, change: 7.2 },
  { symbol: '3661.TW', name: '世芯-KY', indicatorsActive: 3, price: 3120, change: 4.5 },
  { symbol: '2303.TW', name: '聯電', indicatorsActive: 4, price: 52.8, change: 6.1 },
];

export function SignalNotificationSimulator({ className }: SignalNotificationSimulatorProps) {
  const [isEnabled, setIsEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [activeNotifications, setActiveNotifications] = useState<SignalNotification[]>([]);

  const triggerNotification = useCallback(() => {
    const signal = mockSignals[Math.floor(Math.random() * mockSignals.length)];
    const notification: SignalNotification = {
      ...signal,
      id: `notif-${Date.now()}`,
      time: new Date(),
    };

    setActiveNotifications(prev => [notification, ...prev].slice(0, 5));

    // Show toast notification
    if (isEnabled) {
      toast.custom(
        (t) => (
          <div className={cn(
            "bg-background border rounded-lg shadow-lg p-4 max-w-sm animate-in slide-in-from-top-2",
            notification.indicatorsActive === 4 && "border-success/50 bg-success/5"
          )}>
            <div className="flex items-start gap-3">
              <div className={cn(
                "p-2 rounded-full",
                notification.indicatorsActive === 4 ? "bg-success/20" : "bg-warning/20"
              )}>
                <Flame className={cn(
                  "h-5 w-5",
                  notification.indicatorsActive === 4 ? "text-success" : "text-warning"
                )} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-semibold">{notification.name}</p>
                  <Badge variant="outline" className="text-xs font-mono">
                    {notification.symbol}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {notification.indicatorsActive}/4 有同步觸發
                </p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-lg font-bold">${notification.price}</span>
                  <span className="text-success font-medium">+{notification.change}%</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => toast.dismiss(t)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ),
        {
          duration: 5000,
          position: 'top-right',
        }
      );

      // Play sound effect (simulated)
      if (soundEnabled) {
        // In a real app, you'd play an audio file here
        console.log('🔔 Notification sound played');
      }
    }
  }, [isEnabled, soundEnabled]);

  // Simulate periodic notifications
  useEffect(() => {
    if (!isEnabled) return;

    const interval = setInterval(() => {
      // Random chance to trigger (1 in 4)
      if (Math.random() < 0.25) {
        triggerNotification();
      }
    }, 8000);

    return () => clearInterval(interval);
  }, [isEnabled, triggerNotification]);

  const dismissNotification = (id: string) => {
    setActiveNotifications(prev => prev.filter(n => n.id !== id));
  };

  return (
    <Card className={cn("", className)}>
      <CardContent className="pt-4 space-y-4">
        {/* Settings */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isEnabled ? (
              <Bell className="h-5 w-5 text-success" />
            ) : (
              <BellOff className="h-5 w-5 text-muted-foreground" />
            )}
            <div>
              <p className="font-medium">4有訊號推播</p>
              <p className="text-xs text-muted-foreground">
                即時接收漲停訊號通知
              </p>
            </div>
          </div>
          <Switch
            checked={isEnabled}
            onCheckedChange={setIsEnabled}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {soundEnabled ? (
              <Volume2 className="h-5 w-5 text-muted-foreground" />
            ) : (
              <VolumeX className="h-5 w-5 text-muted-foreground" />
            )}
            <Label>提示音效</Label>
          </div>
          <Switch
            checked={soundEnabled}
            onCheckedChange={setSoundEnabled}
            disabled={!isEnabled}
          />
        </div>

        {/* Manual Test Button */}
        <Button
          variant="outline"
          className="w-full"
          onClick={triggerNotification}
          disabled={!isEnabled}
        >
          <Bell className="h-4 w-4 mr-2" />
          測試推播
        </Button>

        {/* Recent Notifications */}
        {activeNotifications.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">最近通知</p>
            {activeNotifications.map(notification => (
              <div
                key={notification.id}
                className={cn(
                  "p-3 rounded-lg border transition-all",
                  notification.indicatorsActive === 4
                    ? "bg-success/5 border-success/20"
                    : "bg-muted/50 border-border"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Flame className={cn(
                      "h-4 w-4",
                      notification.indicatorsActive === 4 ? "text-success" : "text-warning"
                    )} />
                    <span className="font-medium">{notification.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {notification.indicatorsActive}/4 有
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => dismissNotification(notification.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex items-center justify-between mt-1 text-sm">
                  <span className="text-muted-foreground font-mono">{notification.symbol}</span>
                  <span className="text-success font-medium">+{notification.change}%</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center">
          ⚠️ 模擬推播，實際使用需要後端支援
        </p>
      </CardContent>
    </Card>
  );
}
