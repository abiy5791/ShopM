import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import type { ActivityLog, Paginated } from "@/types";

const LEVEL_VARIANT = {
  info: "secondary",
  warn: "accent",
  critical: "destructive",
} as const;

export default function ActivityPage() {
  const activeShopId = useAuthStore((s) => s.activeShopId);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["activity", activeShopId],
    enabled: Boolean(activeShopId),
    queryFn: async () => {
      const res = await api.get<Paginated<ActivityLog>>("/activity");
      return res.data;
    },
  });

  const rows = data?.results ?? [];

  return (
    <div>
      <PageHeader title="Activity log" description="Audit trail of actions in this shop." />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Level</th>
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t">
                    {Array.from({ length: 4 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-24" />
                      </td>
                    ))}
                  </tr>
                ))}

              {!isLoading &&
                rows.map((row) => (
                  <tr key={row.id} className="border-t transition-colors hover:bg-muted/40">
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs tabular-nums text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 font-medium">{row.action}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{row.user_email ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={LEVEL_VARIANT[row.level]}>{row.level}</Badge>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {!isLoading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <ScrollText className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">
              {isError ? "Couldn't load activity." : "No activity yet"}
            </p>
            <p className="text-xs text-muted-foreground">
              Actions like sign-ins and settings changes will appear here.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
