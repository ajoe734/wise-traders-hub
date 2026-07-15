import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // text-base 保 16px 給所有觸控裝置（防 iOS/iPadOS Safari 聚焦自動 zoom）；
          // 桌面（pointer:fine，滑鼠）才縮到 text-sm — 比 md: 寬度分斷更準確，
          // 因為 iPhone Plus / iPad 橫向都會 >768px 但仍為觸控裝置。
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base [@media(pointer:fine)]:text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
