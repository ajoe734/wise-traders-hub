/**
 * ShareButton — 多通道分享（複製 / 系統分享 / QR Code）。
 *
 * 對於公開頁面（expert / experts / pricing / home / checkup），分享 URL 是
 * `https://legendflow.tw/...` canonical（IG/Line 友善、不像 supabase.co 被擋）。
 * 對於 ProtectedRoute（signal / journal / plan），走 share-og crawler 跳板。
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Share2, Check, Copy, QrCode, Send, Instagram, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildShareUrl, copyShareUrl, type ShareTarget } from "@/lib/shareUrl";
import { toast } from "sonner";

interface Props {
  target: ShareTarget;
  className?: string;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "default" | "outline" | "ghost" | "secondary";
  label?: string;
  /** 系統分享時的標題與描述（navigator.share）。 */
  shareTitle?: string;
  shareText?: string;
}

function qrPngUrl(target: string, size = 512): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(target)}`;
}

export function ShareButton({
  target,
  className,
  size = "sm",
  variant = "outline",
  label = "分享",
  shareTitle,
  shareText,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const url = useMemo(() => buildShareUrl(target), [target]);
  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function handleCopy() {
    const ok = await copyShareUrl(target);
    if (ok) {
      setCopied(true);
      toast.success("連結已複製", { description: url });
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("複製失敗，請手動複製網址");
    }
  }

  async function handleNativeShare() {
    if (!canNativeShare) {
      handleCopy();
      return;
    }
    try {
      await navigator.share({
        title: shareTitle || "legendflow",
        text: shareText || "",
        url,
      });
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        // fallback：複製
        handleCopy();
      }
    }
  }

  function handleInstagram() {
    // IG API 不允許直接寫入限動/貼文；複製連結並提示用戶貼到限動的「連結貼紙」。
    copyShareUrl(target).then((ok) => {
      if (ok) {
        toast.success("連結已複製，可貼到 IG 限動的『連結貼紙』", {
          description: url,
          duration: 6000,
        });
      } else {
        toast.error("複製失敗，請手動複製網址");
      }
    });
  }

  function handleDownloadQr() {
    const a = document.createElement("a");
    a.href = qrPngUrl(url, 1024);
    a.download = "legendflow-share-qr.png";
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size={size}
            variant={variant}
            className={cn("gap-2", className)}
          >
            {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
            {copied ? "已複製" : label}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal break-all">
            {url}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCopy} className="gap-2">
            <Copy className="h-4 w-4" /> 複製連結
          </DropdownMenuItem>
          {canNativeShare && (
            <DropdownMenuItem onClick={handleNativeShare} className="gap-2">
              <Send className="h-4 w-4" /> 系統分享…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={handleInstagram} className="gap-2">
            <Instagram className="h-4 w-4" /> 分享到 IG 限動
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setQrOpen(true)} className="gap-2">
            <QrCode className="h-4 w-4" /> 顯示 QR Code
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>分享 QR Code</DialogTitle>
            <DialogDescription className="break-all text-xs">{url}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4">
            <img
              src={qrPngUrl(url, 512)}
              alt="分享 QR Code"
              width={256}
              height={256}
              className="rounded-md border"
            />
            <div className="flex gap-2 w-full">
              <Button onClick={handleDownloadQr} className="flex-1">
                下載 PNG
              </Button>
              <Button variant="outline" onClick={handleCopy} className="flex-1">
                複製連結
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
