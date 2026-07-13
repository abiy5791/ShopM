import { AlertTriangle, ArrowLeftRight, Boxes, Building2, Receipt } from "lucide-react";
import { type ReactNode, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CompareBarChart } from "@/components/charts";
import { formatMoney } from "@/lib/money";

import { useOwnerDashboard, useShopComparison } from "./api";

export default function OwnerConsolePage() {
  const { data, isLoading } = useOwnerDashboard();

  return (
    <div>
      <PageHeader title="Owner console" description="Live view across all of your shops." />

      {/* Per-shop breakdown */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {isLoading &&
          Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-44 w-full" />)}
        {!isLoading &&
          data?.shops.map((shop) => (
            <Card key={shop.shop_id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2 className="h-4 w-4 text-accent" /> {shop.shop_name}
                </CardTitle>
                <span className="text-xs text-muted-foreground">{shop.currency}</span>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                  <Stat
                    label="Today's sales"
                    value={formatMoney(shop.today.sales_total, shop.currency)}
                    sub={`${shop.today.sales_count} txns`}
                  />
                  <Stat
                    label="Net profit"
                    value={formatMoney(shop.today.net_profit, shop.currency)}
                    tone={shop.today.net_profit >= 0 ? "profit" : "loss"}
                  />
                  <Stat
                    label="Cash balance"
                    value={formatMoney(shop.cash_balance, shop.currency)}
                  />
                  <Stat
                    label="Low stock"
                    value={String(shop.low_stock_count)}
                    sub={`${shop.total_products} products`}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
      </div>

      {/* Comparison */}
      <ComparisonCard />

      {/* Cross-shop lists */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ListCard title="Low-stock alerts" icon={AlertTriangle} loading={isLoading}>
          {data?.low_stock_alerts.length === 0 && <Empty text="No low-stock items." />}
          {data?.low_stock_alerts.map((a, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                {a.product}
                <span className="ml-1.5 text-xs text-muted-foreground">{a.shop_name}</span>
              </span>
              <Badge variant="destructive" className="shrink-0 px-1.5 py-0 font-mono">
                {a.stock}/{a.min_alert}
              </Badge>
            </li>
          ))}
        </ListCard>

        <ListCard title="Recent expenses" icon={Receipt} loading={isLoading}>
          {data?.recent_expenses.length === 0 && <Empty text="No expenses recorded." />}
          {data?.recent_expenses.map((e, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                {e.category ?? "Uncategorised"}
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {e.shop_name}
                  {e.by ? ` · ${e.by}` : ""}
                </span>
              </span>
              <span className="shrink-0 font-mono tabular-nums">
                {formatMoney(e.amount, e.currency)}
              </span>
            </li>
          ))}
        </ListCard>

        <ListCard title="Stock movements" icon={Boxes} loading={isLoading}>
          {data?.stock_movements.length === 0 && <Empty text="No stock movements yet." />}
          {data?.stock_movements.map((m, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                {m.product}
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {m.shop_name} · {m.type}
                </span>
              </span>
              <span
                className={
                  "shrink-0 font-mono tabular-nums " +
                  (m.quantity < 0 ? "text-destructive" : "text-accent")
                }
              >
                {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
              </span>
            </li>
          ))}
        </ListCard>
      </div>
    </div>
  );
}

function ComparisonCard() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const { data, isLoading } = useShopComparison(start, end);

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <ArrowLeftRight className="h-4 w-4 text-accent" /> Shop comparison
          {data && (
            <span className="text-xs font-normal text-muted-foreground">
              {data.period.start} → {data.period.end}
            </span>
          )}
        </CardTitle>
        <div className="flex items-end gap-2">
          <div>
            <Label htmlFor="cmp-start" className="text-xs">
              From
            </Label>
            <Input
              id="cmp-start"
              type="date"
              className="h-8"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="cmp-end" className="text-xs">
              To
            </Label>
            <Input
              id="cmp-end"
              type="date"
              className="h-8"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!isLoading && data && data.shops.length > 1 && (
          <div className="border-b px-4 py-3">
            <CompareBarChart
              data={data.shops as unknown as Record<string, unknown>[]}
              nameKey="shop_name"
              currency={data.shops[0]?.currency ?? "ETB"}
              series={[
                { dataKey: "sales_total", name: "Sales", color: "var(--chart-1)" },
                { dataKey: "expenses", name: "Expenses", color: "var(--chart-2)" },
                { dataKey: "net_profit", name: "Net profit", color: "var(--chart-3)" },
              ]}
              height={240}
            />
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Shop</TableHead>
              <TableHead className="text-right">Sales</TableHead>
              <TableHead className="text-right">Txns</TableHead>
              <TableHead className="text-right">Gross profit</TableHead>
              <TableHead className="text-right">Expenses</TableHead>
              <TableHead className="text-right">Net profit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 2 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {!isLoading &&
              data?.shops.map((row) => (
                <TableRow key={row.shop_id}>
                  <TableCell>
                    <Badge variant={row.rank === 1 ? "accent" : "secondary"} className="px-2">
                      {row.rank}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{row.shop_name}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatMoney(row.sales_total, row.currency)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.sales_count}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatMoney(row.gross_profit, row.currency)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatMoney(row.expenses, row.currency)}
                  </TableCell>
                  <TableCell
                    className={
                      "text-right font-mono font-semibold tabular-nums " +
                      (row.net_profit >= 0 ? "text-accent" : "text-destructive")
                    }
                  >
                    {formatMoney(row.net_profit, row.currency)}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "profit" | "loss";
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          "font-mono text-lg font-semibold tabular-nums " +
          (tone === "profit" ? "text-accent" : tone === "loss" ? "text-destructive" : "")
        }
      >
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function ListCard({
  title,
  icon: Icon,
  loading,
  children,
}: {
  title: string;
  icon: typeof Boxes;
  loading: boolean;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-accent" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-24 w-full" /> : <ul className="space-y-2">{children}</ul>}
      </CardContent>
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-4 text-center text-sm text-muted-foreground">{text}</p>;
}
