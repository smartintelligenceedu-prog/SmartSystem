"use client";

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/i18n-client";
import { searchChildrenAction, redeemVoucher } from "./actions";
import type { ChildSearchResult } from "./data";

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("zh-CN");
}

export function RedeemForm() {
  const [isPending, startTransition] = useTransition();
  const [voucherCode, setVoucherCode] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChildSearchResult[]>([]);
  const [selectedChild, setSelectedChild] = useState<ChildSearchResult | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  function doSearch() {
    setMessage(null);
    startTransition(async () => {
      const found = await searchChildrenAction(query);
      setResults(found);
    });
  }

  function doRedeem() {
    if (!selectedChild) return;
    startTransition(async () => {
      const result = await redeemVoucher(voucherCode, selectedChild.child_id);
      if (result.ok) {
        setMessage({ text: ct("finance.institutional.voucher.redeem_success"), ok: true });
        setVoucherCode("");
        setSelectedChild(null);
        setResults([]);
        setQuery("");
      } else {
        setMessage({ text: ct(result.errorKey as Parameters<typeof ct>[0]), ok: false });
      }
    });
  }

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div className="space-y-2">
          <Label htmlFor="voucher_code">{ct("finance.institutional.voucher.code_label")}</Label>
          <Input
            id="voucher_code"
            value={voucherCode}
            onChange={(e) => setVoucherCode(e.target.value)}
            placeholder={ct("finance.institutional.voucher.code_placeholder")}
            className="font-mono uppercase"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="child_search">{ct("finance.institutional.voucher.search_child_label")}</Label>
          <div className="flex gap-2">
            <Input
              id="child_search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={ct("finance.institutional.voucher.search_child_placeholder")}
            />
            <Button type="button" variant="secondary" disabled={isPending} onClick={doSearch}>
              {ct("finance.institutional.voucher.search_button")}
            </Button>
          </div>
        </div>

        {results.length > 0 && (
          <div className="divide-y rounded-md border">
            {results.map((r) => (
              <button
                key={r.child_id}
                type="button"
                onClick={() => setSelectedChild(r)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent ${
                  selectedChild?.child_id === r.child_id ? "bg-accent" : ""
                }`}
              >
                <span className="font-medium">{r.child_name}</span>
                <span className="text-muted-foreground">
                  {r.customer_name} · {formatDate(r.date_of_birth)}
                </span>
              </button>
            ))}
          </div>
        )}

        {selectedChild && (
          <p className="text-sm text-muted-foreground">
            {ct("finance.institutional.voucher.selected_child_label")}: <span className="font-medium text-foreground">{selectedChild.child_name}</span> (
            {selectedChild.customer_name})
          </p>
        )}

        {message && <p className={`text-sm ${message.ok ? "text-emerald-600" : "text-destructive"}`}>{message.text}</p>}

        <Button type="button" disabled={isPending || !voucherCode.trim() || !selectedChild} onClick={doRedeem}>
          {ct("finance.institutional.voucher.redeem_button")}
        </Button>
      </CardContent>
    </Card>
  );
}
