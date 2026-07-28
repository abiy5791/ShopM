import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import type { ReportData } from "@/types";

export type ReportKey = "sales" | "inventory" | "profit" | "cashflow";

export interface ReportParams {
  period?: string;
  start?: string;
  end?: string;
}

export function useReport(key: ReportKey, params: ReportParams, enabled = true) {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["report", activeShopId, key, params],
    enabled: enabled && Boolean(activeShopId),
    queryFn: async () =>
      (
        await api.get<ReportData>(`/reports/${key}`, {
          params: {
            period: key === "sales" ? params.period : undefined,
            start: params.start || undefined,
            end: params.end || undefined,
          },
        })
      ).data,
  });
}

/** Download a report as PDF or XLSX (?export=). */
export async function downloadReport(key: ReportKey, format: "pdf" | "xlsx", params: ReportParams) {
  const res = await api.get(`/reports/${key}`, {
    params: {
      export: format,
      period: key === "sales" ? params.period : undefined,
      start: params.start || undefined,
      end: params.end || undefined,
    },
    responseType: "blob",
  });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${key}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}
