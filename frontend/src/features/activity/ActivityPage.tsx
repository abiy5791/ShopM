import { ScrollText, Search } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { type ActivityFilters, useActivity } from "./api";

const LEVEL_VARIANT = {
  info: "secondary",
  warn: "accent",
  critical: "destructive",
} as const;

export default function ActivityPage() {
  const [filters, setFilters] = useState<ActivityFilters>({ page: 1 });
  const { data, isLoading, isError } = useActivity(filters);
  const rows = data?.results ?? [];

  function set<K extends keyof ActivityFilters>(key: K, value: ActivityFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value, page: 1 }));
  }

  return (
    <div>
      <PageHeader title="Activity log" description="Audit trail of actions in this shop." />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search action / entity"
            className="pl-8"
            value={filters.search ?? ""}
            onChange={(e) => set("search", e.target.value)}
          />
        </div>
        <div className="w-36">
          <Select
            value={filters.level ?? "all"}
            onValueChange={(v) => set("level", v === "all" ? undefined : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warn">Warning</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="after" className="text-xs">
            From
          </Label>
          <Input
            id="after"
            type="date"
            className="h-9"
            value={filters.created_after ?? ""}
            onChange={(e) => set("created_after", e.target.value || undefined)}
          />
        </div>
        <div>
          <Label htmlFor="before" className="text-xs">
            To
          </Label>
          <Input
            id="before"
            type="date"
            className="h-9"
            value={filters.created_before ?? ""}
            onChange={(e) => set("created_before", e.target.value || undefined)}
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-t-0">
              <TableHead>Time</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Level</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 4 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {!isLoading &&
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-medium">{row.action}</TableCell>
                  <TableCell className="text-muted-foreground">{row.user_email ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={LEVEL_VARIANT[row.level]}>{row.level}</Badge>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>

        {!isLoading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <ScrollText className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">
              {isError ? "Couldn't load activity." : "No activity matches your filters"}
            </p>
          </div>
        )}
      </Card>

      {data && data.count > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>{data.count} entries</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!data.previous}
              onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!data.next}
              onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
