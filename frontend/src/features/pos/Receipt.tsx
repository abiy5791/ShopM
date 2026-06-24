import { formatMoney } from "@/lib/money";
import type { ReceiptData } from "@/types";

/** Thermal-style receipt, sized for an 80mm roll. Printed via the @media print
 *  rule in index.css that isolates #receipt-print. */
export function Receipt({ data }: { data: ReceiptData }) {
  const money = (v: number) => formatMoney(v, data.currency || "USD");
  return (
    <div id="receipt-print" className="mx-auto max-w-[320px] bg-card p-4 font-mono text-xs">
      <div className="text-center">
        <p className="text-sm font-semibold uppercase tracking-wide">{data.shop_name}</p>
        {data.shop_address && <p className="text-muted-foreground">{data.shop_address}</p>}
        <p className="mt-1 text-muted-foreground">{new Date(data.created_at).toLocaleString()}</p>
        <p className="text-muted-foreground">Served by {data.cashier_name}</p>
        {data.offline && (
          <p className="mt-1 font-semibold text-destructive">OFFLINE — pending sync</p>
        )}
      </div>

      <div className="my-2 border-t border-dashed" />

      <table className="w-full">
        <tbody>
          {data.items.map((i, idx) => (
            <tr key={idx} className="align-top">
              <td className="py-0.5">
                {i.quantity} × {i.name}
                <div className="text-muted-foreground">@ {money(i.unit_price)}</div>
              </td>
              <td className="py-0.5 text-right tabular-nums">{money(i.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="my-2 border-t border-dashed" />

      <Line label="Subtotal" value={money(data.subtotal)} />
      {data.discount > 0 && <Line label="Discount" value={`−${money(data.discount)}`} />}
      {data.tax > 0 && <Line label="Tax" value={money(data.tax)} />}
      <Line label="Total" value={money(data.total)} strong />
      <Line label="Paid" value={money(data.amount_paid)} />
      <Line label="Change" value={money(data.change)} />

      {data.receipt_footer && (
        <p className="mt-3 text-center text-muted-foreground">{data.receipt_footer}</p>
      )}
      <p className="mt-2 text-center text-muted-foreground">Thank you!</p>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={"flex justify-between py-0.5 " + (strong ? "text-sm font-semibold" : "")}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
