import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          // 16px on touch screens is not a style choice: iOS silently zooms the
          // whole page in when you focus a control smaller than that, and never
          // zooms back out. Desktop keeps the tighter 14px.
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base shadow-sm transition-colors md:text-sm",
          "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          "disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
