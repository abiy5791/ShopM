import { Pencil, Plus, Search, Users } from "lucide-react";
import { useState } from "react";

import { KpiRow } from "@/components/kpi";
import { ListCard } from "@/components/list-card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useActiveShop } from "@/features/pos/api";
import { formatMoney } from "@/lib/money";
import { useSummary } from "@/lib/summary";
import type { Customer } from "@/types";

import { useCustomers } from "./api";
import { CustomerDetailDialog } from "./CustomerDetailDialog";
import { CustomerFormDialog } from "./CustomerFormDialog";

export default function CustomersPage() {
  const shop = useActiveShop();
  const currency = shop?.currency ?? "ETB";
  const [search, setSearchRaw] = useState("");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | undefined>(undefined);
  const [detail, setDetail] = useState<Customer | null>(null);

  function setSearch(value: string) {
    setSearchRaw(value);
    setPage(1); // a new search always starts from the first page
  }

  const { data, isLoading, isError, refetch } = useCustomers(search, page);
  const summary = useSummary("customers");
  const rows = data?.results ?? [];

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Regular customers and their credit balances."
        actions={
          <Button
            size="sm"
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New customer
          </Button>
        }
      />

      <KpiRow summary={summary.data} loading={summary.isLoading} />

      <div className="mb-4 max-w-xs">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name or phone"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        {/* Desktop table */}
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow className="border-t-0">
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 4 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {!isLoading &&
                rows.map((c) => (
                  <TableRow
                    key={c.id}
                    tabIndex={0}
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => setDetail(c)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDetail(c);
                      }
                    }}
                  >
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-muted-foreground">{c.phone || "—"}</TableCell>
                    <TableCell
                      className={
                        "text-right font-mono tabular-nums " +
                        (c.credit_balance_cached > 0 ? "text-destructive" : "")
                      }
                    >
                      {formatMoney(c.credit_balance_cached, currency)}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`Edit ${c.name}`}
                          onClick={() => {
                            setEditing(c);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>

        {/* Mobile cards */}
        <ul className="divide-y md:hidden">
          {isLoading &&
            Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="px-4 py-3">
                <Skeleton className="h-10 w-full" />
              </li>
            ))}
          {!isLoading &&
            rows.map((c) => (
              <li key={c.id}>
                <ListCard
                  onClick={() => setDetail(c)}
                  title={c.name}
                  subtitle={c.phone || "No phone"}
                  trailing={
                    <span
                      className={
                        "font-mono text-sm font-semibold tabular-nums" +
                        (c.credit_balance_cached > 0 ? " text-destructive" : "")
                      }
                    >
                      {formatMoney(c.credit_balance_cached, currency)}
                    </span>
                  }
                  actions={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Edit ${c.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(c);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  }
                />
              </li>
            ))}
        </ul>

        {!isLoading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <Users className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">
              {isError ? "Couldn't load customers." : "No customers yet"}
            </p>
            <p className="text-xs text-muted-foreground">Add a customer to track credit.</p>
            {isError && (
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            )}
          </div>
        )}
      </Card>

      {data && data.count > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>{data.count} total</span>
          {(data.previous || data.next) && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!data.previous}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!data.next}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      <CustomerFormDialog open={formOpen} onOpenChange={setFormOpen} customer={editing} />
      <CustomerDetailDialog
        customer={detail}
        currency={currency}
        onOpenChange={(o) => !o && setDetail(null)}
      />
    </div>
  );
}
