/**
 * ShareButton — 一鍵複製「OG 友善的分享 URL」（走 share-og edge function）。
 *
 * 不直接複製當前頁面的 in-app URL，因為 /app/* 是 ProtectedRoute，
 * 社群 crawler 無法看到內容；改複製 share-og 端點，crawler 看到 OG，人類自動跳轉。
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Share2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { copyShareUrl, type ShareTarget } from "@/lib/shareUrl";
import { toast } from "sonner";

interface Props {
  target: ShareTarget;
  className?: string;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "default" | "outline" | "ghost" | "secondary";
  label?: string;
}

export function ShareButton({
  target,
  className,
  size = "sm",
  variant = "outline",
  label = "分享連結",
}: Props) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    const ok = await copyShareUrl(target);
    if (ok) {
      setCopied(true);
      toast.success("分享連結已複製", { description: "可貼到 Line / FB / X 預覽社群卡片" });
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("複製失敗，請手動複製網址");
    }
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={handleClick}
      className={cn("gap-2", className)}
    >
      {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
      {copied ? "已複製" : label}
    </Button>
  );
}
