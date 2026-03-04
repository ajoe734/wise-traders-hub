 import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
 import { Badge } from "@/components/ui/badge";
 import { Separator } from "@/components/ui/separator";
 import { Calendar, Clock, TrendingUp, TrendingDown, DollarSign, BarChart3 } from "lucide-react";

export interface StockTradeDetail {
  symbol: string;
  name: string;
  returnPct: number;
  entryDate: string;
  holdingDays: number;
  entryPrice: number;
  currentPrice: number;
  pnlAmt?: number;
  contributionNote: string;
}
 import { cn } from "@/lib/utils";
 
 interface StockTradeDetailSheetProps {
   stock: StockTradeDetail | null;
   open: boolean;
   onOpenChange: (open: boolean) => void;
   periodLabel?: string;
 }
 
 export function StockTradeDetailSheet({
   stock,
   open,
   onOpenChange,
   periodLabel,
 }: StockTradeDetailSheetProps) {
   if (!stock) return null;
 
   const isPositive = stock.returnPct >= 0;
 
   return (
     <Sheet open={open} onOpenChange={onOpenChange}>
       <SheetContent side="right" className="w-[320px] sm:w-[380px] overflow-y-auto">
         <SheetHeader className="space-y-1 pb-4">
           <div className="flex items-center gap-2">
             <SheetTitle className="text-xl">{stock.name}</SheetTitle>
             <Badge variant="outline" className="font-mono text-xs">
               {stock.symbol}
             </Badge>
           </div>
           {periodLabel && (
             <SheetDescription>
               {periodLabel} 績效表現
             </SheetDescription>
           )}
         </SheetHeader>
 
         <Separator />
 
         {/* 報酬率 Highlight */}
         <div className={cn(
           "my-6 p-4 rounded-lg text-center",
           isPositive 
             ? "bg-success/10 dark:bg-success/20" 
             : "bg-destructive/10 dark:bg-destructive/20"
         )}>
           <p className="text-sm text-muted-foreground mb-1">本期報酬率</p>
           <p className={cn(
             "text-3xl font-bold tabular-nums",
             isPositive ? "text-success" : "text-destructive"
           )}>
             {isPositive ? "+" : ""}{stock.returnPct.toFixed(2)}%
           </p>
         </div>
 
         {/* 交易細節列表 */}
         <div className="space-y-4">
           {/* 建倉時間 */}
           <DetailRow
             icon={<Calendar className="h-4 w-4" />}
             label="建倉時間"
             value={formatDate(stock.entryDate)}
           />
 
           {/* 持有天數 */}
           <DetailRow
             icon={<Clock className="h-4 w-4" />}
             label="持有天數"
             value={`${stock.holdingDays} 天`}
           />
 
           <Separator />
 
           {/* 進場價格 */}
           <DetailRow
             icon={<DollarSign className="h-4 w-4" />}
             label="進場價格"
             value={`$${stock.entryPrice.toLocaleString()}`}
           />
 
           {/* 目前價格 */}
           <DetailRow
             icon={isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
             label="目前價格"
             value={`$${stock.currentPrice.toLocaleString()}`}
             valueClassName={isPositive ? "text-success" : "text-destructive"}
           />
 
           {/* 損益金額（可選） */}
           {stock.pnlAmt !== undefined && (
             <DetailRow
               icon={<BarChart3 className="h-4 w-4" />}
               label="損益金額"
               value={`${stock.pnlAmt >= 0 ? "+" : ""}$${stock.pnlAmt.toLocaleString()}`}
               valueClassName={stock.pnlAmt >= 0 ? "text-success" : "text-destructive"}
             />
           )}
         </div>
 
         <Separator className="my-6" />
 
         {/* 績效貢獻說明 */}
         <div className="space-y-2">
           <h4 className="text-sm font-semibold flex items-center gap-2">
             <span className="h-1.5 w-1.5 rounded-full bg-primary" />
             績效貢獻說明
           </h4>
           <p className="text-sm text-muted-foreground leading-relaxed">
             {stock.contributionNote}
           </p>
         </div>
       </SheetContent>
     </Sheet>
   );
 }
 
 // 輔助元件：細節列
 function DetailRow({ 
   icon, 
   label, 
   value, 
   valueClassName 
 }: { 
   icon: React.ReactNode; 
   label: string; 
   value: string;
   valueClassName?: string;
 }) {
   return (
     <div className="flex items-center justify-between">
       <div className="flex items-center gap-2 text-muted-foreground">
         {icon}
         <span className="text-sm">{label}</span>
       </div>
       <span className={cn("font-medium tabular-nums", valueClassName)}>
         {value}
       </span>
     </div>
   );
 }
 
 // 日期格式化
 function formatDate(dateStr: string): string {
   const date = new Date(dateStr);
   return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
 }