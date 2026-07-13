import { Plus, Search, UserCog } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { useAuthStore } from "@/lib/auth";
import type { StaffMember } from "@/types";

import { useStaff } from "./api";
import { StaffDetailDialog } from "./StaffDetailDialog";
import { StaffFormDialog } from "./StaffFormDialog";

/** Staff accounts across the caller's branches (v2 plan §3). */
export function StaffTab() {
  const me = useAuthStore((s) => s.user);
  const [search, setSearch] = useState("");
  const staff = useStaff(search);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<StaffMember | null>(null);

  const rows = staff.data?.results ?? [];

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search staff"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Add staff
          </Button>
        </div>

        {staff.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center">
            <UserCog className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm font-medium">No staff found</p>
            <p className="text-xs text-muted-foreground">
              Add a staff member to give them access to a branch.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Branches</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead className="w-16 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((member) => {
                const isSelf = member.id === me?.id;
                return (
                  <TableRow key={member.id} className={member.is_active ? "" : "opacity-60"}>
                    <TableCell className="font-medium">
                      {member.full_name}
                      {isSelf && (
                        <Badge variant="secondary" className="ml-2">
                          You
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{member.email}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {member.memberships.map((m) => (
                          <Badge key={m.id} variant="outline">
                            {m.shop_name} · {m.role}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {member.is_active ? (
                        <Badge variant="accent">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Deactivated</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.last_login ? new Date(member.last_login).toLocaleString() : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      {!isSelf && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          onClick={() => setSelected(member)}
                        >
                          Manage
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <StaffFormDialog open={creating} onOpenChange={setCreating} />
        <StaffDetailDialog member={selected} onOpenChange={(open) => !open && setSelected(null)} />
      </CardContent>
    </Card>
  );
}
