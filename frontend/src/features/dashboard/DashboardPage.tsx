import { Boxes, Receipt, ScanLine, TrendingUp, Users, Wallet } from "lucide-react";
import { Link } from "react-router-dom";

import { HBarChart, Sparkline } from "@/components/charts";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveShop } from "@/features/pos/api";
import { useAuthStore } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";

import { useDashboard } from "./api";

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore(
    (s) => s.memberships.find((m) => m.shop_id === s.activeShopId)?.role ?? null,
  );
  const isOwner = role === "owner";
  const shop = useActiveShop();
  const currency = shop?.currency ?? "ETB";
  const { data, isLoading } = useDashboard(isOwner);

  const firstName = user?.full_name.split(" ")[0] ?? "";

  if (!isOwner) {
    // Cashiers don't see financials (plan §8) — give them quick actions instead.
    return (
      <div>
        <PageHeader title={`Welcome, ${firstName}`} description="Quick actions for your shift." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <QuickLink to="/pos" icon={ScanLine} title="Point of Sale" desc="Ring up a sale" />
          <QuickLink
            to="/customers"
            icon={Users}
            title="Customers"
            desc="Manage customers & credit"
          />
        </div>
      </div>
    );
  }

  const t = data?.today;

  return (
    <div>
      <PageHeader title={`Welcome, ${firstName}`} description="Today at a glance." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Today's sales"
          icon={Receipt}
          value={t ? formatMoney(t.sales_total, currency) : undefined}
          sub={t ? `${t.sales_count} sale${t.sales_count === 1 ? "" : "s"}` : ""}
          loading={isLoading}
          spark={
            data?.week_series?.length ? (
              <Sparkline
                data={data.week_series as unknown as Record<string, unknown>[]}
                dataKey="total"
              />
            ) : undefined
          }
        />
        <Kpi
          label="Gross profit"
          icon={TrendingUp}
          value={t ? formatMoney(t.gross_profit, currency) : undefined}
          sub={t ? `Net ${formatMoney(t.net_profit, currency)}` : ""}
          loading={isLoading}
        />
        <Kpi
          label="Cash on hand"
          icon={Wallet}
          value={data ? formatMoney(data.cash_balance, currency) : undefined}
          sub="All time: cash received − expenses & purchases"
          loading={isLoading}
          negative={Boolean(data && data.cash_balance < 0)}
        />
        <Kpi
          label="Low-stock items"
          icon={Boxes}
          value={data ? String(data.low_stock_count) : undefined}
          sub={data ? `${data.total_products} products` : ""}
          loading={isLoading}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Best sellers (this month)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : data && data.best_sellers.length > 0 ? (
              <HBarChart
                data={data.best_sellers as unknown as Record<string, unknown>[]}
                dataKey="quantity"
                nameKey="name"
                name="Units sold"
                height={Math.max(120, data.best_sellers.length * 36)}
              />
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">No sales yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent sales</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : data && data.recent_sales.length > 0 ? (
              <ul className="space-y-1.5">
                {data.recent_sales.map((s) => (
                  <li key={s.id} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{formatDateTime(s.created_at)}</span>
                    <span className="font-mono tabular-nums">{formatMoney(s.total, currency)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">No sales yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({
  label,
  icon: Icon,
  value,
  sub,
  loading,
  spark,
  negative = false,
}: {
  label: string;
  icon: typeof Receipt;
  value?: string;
  sub?: string;
  loading: boolean;
  spark?: React.ReactNode;
  negative?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-accent" />
      </CardHeader>
      <CardContent>
        {loading || value === undefined ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div
            className={
              "font-mono text-2xl font-semibold tabular-nums" +
              (negative ? " text-destructive" : "")
            }
          >
            {value}
          </div>
        )}
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
        {spark && <div className="mt-2">{spark}</div>}
      </CardContent>
    </Card>
  );
}

function QuickLink({
  to,
  icon: Icon,
  title,
  desc,
}: {
  to: string;
  icon: typeof Receipt;
  title: string;
  desc: string;
}) {
  return (
    <Link to={to}>
      <Card className="transition-colors hover:border-accent">
        <CardContent className="flex items-center gap-3 p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="font-medium">{title}</p>
            <p className="text-sm text-muted-foreground">{desc}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
