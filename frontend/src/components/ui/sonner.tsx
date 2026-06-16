import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="top-right"
      toastOptions={{
        classNames: {
          toast: "bg-card text-card-foreground border border-border shadow-md",
          error: "text-destructive",
          success: "text-accent",
        },
      }}
    />
  );
}
