import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary - Red CTA
        default: "bg-cta text-cta-foreground hover:bg-cta-hover shadow-sm",
        // Secondary - White with gray border
        secondary: "bg-card text-foreground border border-border hover:bg-muted",
        // Ghost - Transparent with black text
        ghost: "text-foreground hover:bg-muted",
        // Outline - Same as secondary
        outline: "border border-border bg-card text-foreground hover:bg-muted",
        // Destructive
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        // Link
        link: "text-cta underline-offset-4 hover:underline",
        // Legacy variants mapped to new system
        advisor: "bg-cta text-cta-foreground shadow-sm hover:shadow-[0_0_16px_4px_hsla(45,90%,60%,0.5),0_0_32px_8px_hsla(45,90%,55%,0.3)] hover:brightness-110",
        "advisor-outline": "border border-border bg-card text-foreground hover:bg-muted",
        mentor: "bg-foreground text-background shadow-sm hover:shadow-[0_0_16px_4px_hsla(45,90%,60%,0.5),0_0_32px_8px_hsla(45,90%,55%,0.3)] hover:brightness-110",
        "mentor-outline": "border border-border bg-card text-foreground hover:bg-muted",
        hero: "bg-cta text-cta-foreground hover:bg-cta-hover shadow-sm",
        "hero-advisor": "bg-cta text-cta-foreground hover:bg-cta-hover shadow-sm",
        "hero-mentor": "bg-foreground text-background hover:bg-foreground/90 shadow-sm",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        xl: "h-12 rounded-md px-10 text-base",
        icon: "h-10 w-10",
        touch: "h-12 min-w-[44px] px-6",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
