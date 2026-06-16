import { Construction } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";

export default function PlaceholderPage({ title, phase }: { title: string; phase: number }) {
  return (
    <div>
      <PageHeader title={title} />
      <Card className="flex flex-col items-center gap-2 px-4 py-16 text-center">
        <Construction className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm font-medium">Coming in Phase {phase}</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          This section is part of the phased delivery plan and will be built next.
        </p>
      </Card>
    </div>
  );
}
