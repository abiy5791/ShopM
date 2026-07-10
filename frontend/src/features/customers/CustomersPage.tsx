import { Pencil, Plus, Search, Users } from "lucide-react";
import { useState } from "react";

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
import type { Customer } from "@/types";

import { useCustomers } from "./api";
import { CustomerDetailDialog } from "./CustomerDetailDialog";
import { CustomerFormDialog } from "./CustomerFormDialog";

export default function CustomersPage() {
  const shop = useActiveShop();
  const currency = shop?.currency ?? "ETB";
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | undefined>(undefined);
  const [detail, setDetail] = useState<Customer | null>(null);

  const { data, isLoading, isError } = useCustomers(search);
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
                <TableRow key={c.id}>
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
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" onClick={() => setDetail(c)}>
                        View
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
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

        {!isLoading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <Users className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">
              {isError ? "Couldn't load customers." : "No customers yet"}
            </p>
            <p className="text-xs text-muted-foreground">Add a customer to track credit.</p>
          </div>
        )}
      </Card>

      <CustomerFormDialog open={formOpen} onOpenChange={setFormOpen} customer={editing} />
      <CustomerDetailDialog
        customer={detail}
        currency={currency}
        onOpenChange={(o) => !o && setDetail(null)}
      />
    </div>
  );
}
