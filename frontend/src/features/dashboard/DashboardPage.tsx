import { Boxes, Receipt, TrendingUp, Wallet } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/lib/auth";

const KPIS = [
  { label: "Today's sales", icon: Receipt, hint: "Phase 5" },
  { label: "Gross profit", icon: TrendingUp, hint: "Phase 5" },
  { label: "Cash balance", icon: Wallet, hint: "Phase 5" },
  { label: "Low-stock items", icon: Boxes, hint: "Phase 1" },
];

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.full_name.split(" ")[0] ?? ""}`}
        description="Your shop at a glance. Live metrics arrive in Phase 5."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {kpi.label}
              </CardTitle>
              <kpi.icon className="h-4 w-4 text-accent" />
            </CardHeader>
            <CardContent>
              <div className="font-mono text-2xl font-semibold tabular-nums">—</div>
              <p className="mt-1 text-xs text-muted-foreground">Available in {kpi.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
