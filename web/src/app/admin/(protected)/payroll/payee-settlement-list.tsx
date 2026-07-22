"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ct } from "@/lib/i18n-client";
import type { PayeeSettlementRow } from "./data";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-MY", { year: "numeric", month: "long", day: "numeric" });
}

// Settlement history listed one row per payee (not one row per period) so
// the CTO sees exactly who was paid at a glance and can search by name
// right here — no drilling into a period first to find out who's in it.
export function PayeeSettlementList({ rows }: { rows: PayeeSettlementRow[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;

  return (
    <div className="space-y-3">
      <Input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={ct("payroll.run_detail.search_placeholder")}
        className="max-w-xs"
      />
      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ct("payroll.run.history_empty")}</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ct("payroll.run_detail.no_search_match")}</p>
          ) : (
            <div className="divide-y">
              {filtered.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <p>
                      {r.name}{" "}
                      <Badge variant="outline" className="ml-1">
                        {r.payee_type === "introducer" ? ct("payroll.run_detail.introducer_badge") : ct("payroll.run_detail.analyst_badge")}
                      </Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(r.period_start)} – {formatDate(r.period_end)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.bank_account_no
                        ? `🏦 ${r.bank_name ?? "—"} · ${r.bank_account_name ?? "—"} · ${r.bank_account_no}`
                        : ct("payroll.run.bank_info_missing")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums font-medium">{formatMYR(r.gross_amount)}</span>
                    <Button size="sm" variant="ghost" render={<Link href={r.href}>{ct("payroll.view_detail_link")}</Link>} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
