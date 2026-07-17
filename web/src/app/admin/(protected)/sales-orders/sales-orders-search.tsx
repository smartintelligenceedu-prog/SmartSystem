"use client";

import { useState } from "react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SalesOrderRow } from "./data";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  paid: "已付款",
  cancelled: "已取消",
  refunded: "已退款",
};

const ITEM_TYPE_LABEL: Record<string, string> = {
  detection_session: "检测服务（现场付款）",
  voucher_redemption: "检测券兑换",
};

// Matches against every individual name in an order (customer_names), not
// the display string (customer_name collapses to "N 位顾客" for multi-person
// orders) — otherwise searching for one family member's name wouldn't find
// an order they're part of alongside others.
export function SalesOrdersSearch({ orders, isBackOffice }: { orders: SalesOrderRow[]; isBackOffice: boolean }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q ? orders.filter((o) => o.customer_names.some((n) => n.toLowerCase().includes(q))) : orders;

  return (
    <div className="space-y-3">
      <Input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜寻顾客姓名…"
        className="max-w-xs"
      />
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日期</TableHead>
              <TableHead>顾客</TableHead>
              {isBackOffice && <TableHead>分析师</TableHead>}
              <TableHead>类型</TableHead>
              <TableHead>金额</TableHead>
              <TableHead>状态</TableHead>
              {isBackOffice && <TableHead></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={isBackOffice ? 7 : 5} className="text-center text-muted-foreground">
                  {orders.length === 0 ? "尚无订单" : "找不到符合的顾客"}
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
                <TableCell className="text-muted-foreground">{ITEM_TYPE_LABEL[o.item_type] ?? o.item_type}</TableCell>
                <TableCell className="tabular-nums">{formatMYR(o.total_amount)}</TableCell>
                <TableCell>
                  <Badge variant={o.order_status === "paid" ? "secondary" : "outline"}>
                    {ORDER_STATUS_LABEL[o.order_status] ?? o.order_status}
                  </Badge>
                </TableCell>
                {isBackOffice && (
                  <TableCell>
                    {o.review_status === "pending" && (
                      <Button size="sm" variant="outline" render={<Link href={`/admin/sales-orders/${o.order_id}`}>审核</Link>} />
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
