import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { 
  TrendingUp, 
  Users, 
  UserCheck, 
  Building2, 
  CheckCircle, 
  XCircle,
  RotateCcw,
  Trophy,
  Target,
  Lightbulb
} from 'lucide-react';

interface IndicatorState {
  id: '有漲' | '有人' | '有人買' | '有大人買';
  isActive: boolean;
  value: number;
}

interface TrainingScenario {
  id: string;
  name: string;
  symbol: string;
  price: number;
  indicators: IndicatorState[];
  correctAnswer: 'buy' | 'wait' | 'avoid';
  explanation: string;
}

const iconMap = {
  '有漲': TrendingUp,
  '有人': Users,
  '有人買': UserCheck,
  '有大人買': Building2,
};

// Training scenarios
const scenarios: TrainingScenario[] = [
  {
    id: 'scenario-1',
    name: '創意',
    symbol: '3443.TW',
    price: 1420,
    indicators: [
      { id: '有漲', isActive: true, value: 92 },
      { id: '有人', isActive: true, value: 88 },
      { id: '有人買', isActive: true, value: 75 },
      { id: '有大人買', isActive: true, value: 85 },
    ],
    correctAnswer: 'buy',
    explanation: '4有同步觸發，這是最強的進場訊號！股價站上均線、買盤積極、散戶與大戶同步買超。',
  },
  {
    id: 'scenario-2',
    name: '力積電',
    symbol: '6770.TW',
    price: 42.5,
    indicators: [
      { id: '有漲', isActive: true, value: 78 },
      { id: '有人', isActive: true, value: 65 },
      { id: '有人買', isActive: false, value: 35 },
      { id: '有大人買', isActive: true, value: 72 },
    ],
    correctAnswer: 'wait',
    explanation: '3個指標觸發，但「有人買」訊號不足。建議等待散戶買盤跟進再考慮進場。',
  },
  {
    id: 'scenario-3',
    name: '家登',
    symbol: '3680.TW',
    price: 485,
    indicators: [
      { id: '有漲', isActive: true, value: 55 },
      { id: '有人', isActive: false, value: 42 },
      { id: '有人買', isActive: false, value: 28 },
      { id: '有大人買', isActive: false, value: 38 },
    ],
    correctAnswer: 'avoid',
    explanation: '僅1個指標勉強觸發，買盤不足。這種情況下進場風險極高，應該避免。',
  },
  {
    id: 'scenario-4',
    name: '聯電',
    symbol: '2303.TW',
    price: 52.8,
    indicators: [
      { id: '有漲', isActive: true, value: 82 },
      { id: '有人', isActive: true, value: 78 },
      { id: '有人買', isActive: true, value: 68 },
      { id: '有大人買', isActive: false, value: 45 },
    ],
    correctAnswer: 'wait',
    explanation: '3個指標觸發，但缺少主力買盤訊號。可以觀察，等待大戶進場再跟進。',
  },
  {
    id: 'scenario-5',
    name: '世芯-KY',
    symbol: '3661.TW',
    price: 3050,
    indicators: [
      { id: '有漲', isActive: false, value: 38 },
      { id: '有人', isActive: false, value: 42 },
      { id: '有人買', isActive: true, value: 62 },
      { id: '有大人買', isActive: false, value: 35 },
    ],
    correctAnswer: 'avoid',
    explanation: '僅散戶買超，但股價弱勢且大戶賣超。這可能是散戶接刀的訊號，應該避開！',
  },
];

export function InteractiveFourIndicatorsTrainer({ className }: { className?: string }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<'buy' | 'wait' | 'avoid' | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [completed, setCompleted] = useState(0);

  const currentScenario = scenarios[currentIndex];
  const activeCount = currentScenario.indicators.filter(i => i.isActive).length;

  const handleAnswer = (answer: 'buy' | 'wait' | 'avoid') => {
    setSelectedAnswer(answer);
    setShowResult(true);
    setCompleted(prev => prev + 1);
    if (answer === currentScenario.correctAnswer) {
      setScore(prev => prev + 1);
    }
  };

  const handleNext = () => {
    if (currentIndex < scenarios.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setSelectedAnswer(null);
      setShowResult(false);
    }
  };

  const handleReset = () => {
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setShowResult(false);
    setScore(0);
    setCompleted(0);
  };

  const isCorrect = selectedAnswer === currentScenario.correctAnswer;
  const progress = ((currentIndex + 1) / scenarios.length) * 100;
  const isFinished = completed === scenarios.length && showResult && currentIndex === scenarios.length - 1;

  return (
    <Card className={cn("", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4" />
            「4有」指標互動訓練
          </CardTitle>
          <Badge variant="outline">
            {currentIndex + 1} / {scenarios.length}
          </Badge>
        </div>
        <Progress value={progress} className="h-2" />
      </CardHeader>
      <CardContent className="space-y-4">
        {!isFinished ? (
          <>
            {/* Stock Info */}
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="font-semibold text-lg">{currentScenario.name}</p>
                <p className="text-sm text-muted-foreground font-mono">{currentScenario.symbol}</p>
              </div>
              <p className="text-2xl font-bold">${currentScenario.price}</p>
            </div>

            {/* Indicators Display */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">
                目前指標狀態：{activeCount}/4 有
              </p>
              {currentScenario.indicators.map((indicator) => {
                const Icon = iconMap[indicator.id];
                return (
                  <div
                    key={indicator.id}
                    className={cn(
                      "p-3 rounded-lg border flex items-center gap-3 transition-all",
                      indicator.isActive 
                        ? "bg-success/10 border-success/30" 
                        : "bg-muted/30 border-border"
                    )}
                  >
                    <div className={cn(
                      "p-2 rounded-lg",
                      indicator.isActive ? "bg-success/20" : "bg-muted"
                    )}>
                      <Icon className={cn(
                        "h-4 w-4",
                        indicator.isActive ? "text-success" : "text-muted-foreground"
                      )} />
                    </div>
                    <div className="flex-1">
                      <span className="font-medium">{indicator.id}</span>
                    </div>
                    <div className="text-right">
                      <span className={cn(
                        "font-bold",
                        indicator.isActive ? "text-success" : "text-muted-foreground"
                      )}>
                        {indicator.value}%
                      </span>
                    </div>
                    {indicator.isActive ? (
                      <CheckCircle className="h-5 w-5 text-success" />
                    ) : (
                      <XCircle className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Question */}
            <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
              <p className="font-medium text-center">
                📊 根據以上指標，你會如何操作？
              </p>
            </div>

            {/* Answer Buttons */}
            {!showResult ? (
              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant="outline"
                  className="flex-col h-auto py-3 border-success/30 hover:bg-success/10 hover:border-success"
                  onClick={() => handleAnswer('buy')}
                >
                  <TrendingUp className="h-5 w-5 text-success mb-1" />
                  <span>進場</span>
                </Button>
                <Button
                  variant="outline"
                  className="flex-col h-auto py-3 border-warning/30 hover:bg-warning/10 hover:border-warning"
                  onClick={() => handleAnswer('wait')}
                >
                  <Target className="h-5 w-5 text-warning mb-1" />
                  <span>觀望</span>
                </Button>
                <Button
                  variant="outline"
                  className="flex-col h-auto py-3 border-destructive/30 hover:bg-destructive/10 hover:border-destructive"
                  onClick={() => handleAnswer('avoid')}
                >
                  <XCircle className="h-5 w-5 text-destructive mb-1" />
                  <span>避開</span>
                </Button>
              </div>
            ) : (
              /* Result */
              <div className={cn(
                "p-4 rounded-lg",
                isCorrect ? "bg-success/10 border border-success/30" : "bg-destructive/10 border border-destructive/30"
              )}>
                <div className="flex items-center gap-2 mb-2">
                  {isCorrect ? (
                    <>
                      <CheckCircle className="h-5 w-5 text-success" />
                      <span className="font-semibold text-success">正確！</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-5 w-5 text-destructive" />
                      <span className="font-semibold text-destructive">
                        答錯了！正確答案是「{
                          currentScenario.correctAnswer === 'buy' ? '進場' :
                          currentScenario.correctAnswer === 'wait' ? '觀望' : '避開'
                        }」
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Lightbulb className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
                  <p>{currentScenario.explanation}</p>
                </div>
                <Button
                  className="w-full mt-3"
                  onClick={handleNext}
                  disabled={currentIndex >= scenarios.length - 1}
                >
                  {currentIndex < scenarios.length - 1 ? '下一題' : '完成'}
                </Button>
              </div>
            )}
          </>
        ) : (
          /* Final Score */
          <div className="text-center py-6">
            <Trophy className="h-16 w-16 mx-auto text-yellow-500 mb-4" />
            <h3 className="text-2xl font-bold mb-2">訓練完成！</h3>
            <p className="text-lg mb-4">
              你的得分：<span className="text-success font-bold">{score}</span> / {scenarios.length}
            </p>
            <p className="text-muted-foreground mb-6">
              {score === scenarios.length 
                ? '🎉 完美！你已經掌握了「4有」指標的判讀！'
                : score >= scenarios.length * 0.6
                  ? '👍 不錯！再多練習幾次會更熟練！'
                  : '💪 繼續加油！建議複習教學內容後再試一次。'}
            </p>
            <Button onClick={handleReset} variant="outline">
              <RotateCcw className="h-4 w-4 mr-2" />
              重新訓練
            </Button>
          </div>
        )}

        {/* Score Display */}
        {!isFinished && completed > 0 && (
          <div className="flex items-center justify-center gap-4 text-sm">
            <span className="text-muted-foreground">
              目前得分：<span className="font-semibold text-success">{score}</span> / {completed}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
