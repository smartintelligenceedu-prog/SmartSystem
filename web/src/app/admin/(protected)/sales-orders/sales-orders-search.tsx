"use client";

import { useState } from "react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SalesOrderRow } from "./data";
import { ct } from "@/lib/i18n-client";
import type { TranslationKey } from "@/lib/i18n-shared";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

const ORDER_STATUS_KEY = {
  pending: "order.status.pending",
  paid: "order.status.paid",
  cancelled: "order.status.cancelled",
  refunded: "order.status.refunded",
} satisfies Record<string, TranslationKey>;

const ITEM_TYPE_KEY = {
  detection_session: "reports.item_type.detection_session",
  voucher_redemption: "reports.item_type.voucher_redemption",
} satisfies Record<string, TranslationKey>;

// Matches against every individual name in an order (customer_names), not
// the display string (customer_name collapses to "N 位顾客" for multi-person
// orders) — otherwise searching for one family member's name wouldn't find
// an order they're part of alongside others.
export function SalesOrdersSearch({ orders, isBackOffice }: { orders: SalesOrderRow[]; isBackOffice: boolean }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q ? orders.filter((o) => o.customer_names.some((n) => n.toLowerCase().includes(q))) : orders;
  const itemTypeLabel = (type: string) => (type in ITEM_TYPE_KEY ? ct(ITEM_TYPE_KEY[type as keyof typeof ITEM_TYPE_KEY]) : type);
  const orderStatusLabel = (status: string) => (status in ORDER_STATUS_KEY ? ct(ORDER_STATUS_KEY[status as keyof typeof ORDER_STATUS_KEY]) : status);

  return (
    <div className="space-y-3">
      <Input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={ct("sales_orders.list.search_placeholder")}
        className="max-w-xs"
      />
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{ct("sales_orders.list.column.date")}</TableHead>
              <TableHead>{ct("sales_orders.list.column.customer")}</TableHead>
              {isBackOffice && <TableHead>{ct("sales_orders.list.column.analyst")}</TableHead>}
              <TableHead>{ct("sales_orders.list.column.type")}</TableHead>
              <TableHead>{ct("sales_orders.list.column.amount")}</TableHead>
              <TableHead>{ct("sales_orders.list.column.status")}</TableHead>
              {isBackOffice && <TableHead></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={isBackOffice ? 7 : 5} className="text-center text-muted-foreground">
                  {orders.length === 0 ? ct("sales_orders.list.empty_no_orders") : ct("sales_orders.list.empty_no_match")}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((o) => (
              <TableRow key={o.order_id}>
                <TableCell className="text-muted-foreground tabular-nums">
                  {new Date(o.created_at).toLocaleDateString("zh-CN")}
                </TableCell>
                <TableCell>{o.customer_name}</TableCell>
                {isBackOffice && <TableCell className="text-muted-foreground">{o.analyst_name}</TableCell>}
                <TableCell className="text-muted-foreground">{itemTypeLabel(o.item_type)}</TableCell>
                <TableCell className="tabular-nums">{formatMYR(o.total_amount)}</TableCell>
                <TableCell>
                  <Badge variant={o.order_status === "paid" ? "secondary" : "outline"}>{orderStatusLabel(o.order_status)}</Badge>
                </TableCell>
                {isBackOffice && (
                  <TableCell>
                    {o.review_status === "pending" && (
                      <Button
                        size="sm"
                        variant="outline"
                        render={<Link href={`/admin/sales-orders/${o.order_id}`}>{ct("sales_orders.list.review_button")}</Link>}
                      />
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
