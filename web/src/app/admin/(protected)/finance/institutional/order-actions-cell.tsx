"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/lib/i18n";
import { issueInvoice, issueFinalSettlementInvoice, recordPayment } from "./actions";
import type { InstitutionalOrderRow } from "./data";

type PaymentMode = "deposit" | "full_payment" | "final_payment";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

export function OrderActionsCell({ row }: { row: InstitutionalOrderRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<PaymentMode | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  function openPaymentForm(next: PaymentMode, prefillAmount: number | null) {
    setMode(next);
    setAmount(prefillAmount !== null ? String(prefillAmount) : "");
    setMethod("");
    setReferenceNo("");
    setMessage(null);
  }

  function submitPayment() {
    if (!mode) return;
    startTransition(async () => {
      const result = await recordPayment(row.order_id, Number(amount), method, mode, referenceNo);
      setMessage(result.message);
      if (result.ok) {
        setMode(null);
        router.refresh();
      }
    });
  }

  function doIssueInvoice() {
    startTransition(async () => {
      const result = await issueInvoice(row.order_id);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  function doIssueFinalSettlement() {
    startTransition(async () => {
      const result = await issueFinalSettlementInvoice(row.order_id);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  const viewLinks = (
    <div className="flex flex-wrap justify-end gap-3 text-xs">
      {row.invoice_id && (
        <a href={`/admin/finance/institutional/invoices/${row.invoice_id}`} target="_blank" rel="noreferrer" className="text-primary underline">
          {t("finance.institutional.action.view_invoice")}
        </a>
      )}
      {row.latest_payment_id && (
        <a href={`/admin/finance/institutional/payments/${row.latest_payment_id}`} target="_blank" rel="noreferrer" className="text-primary underline">
          {t("finance.institutional.action.view_receipt")}
        </a>
      )}
    </div>
  );

  if (row.state === "fully_paid" || row.state === "closed") {
    return (row.invoice_id || row.latest_payment_id) ? <div className="flex flex-col items-end gap-1">{viewLinks}</div> : null;
  }

  if (mode) {
    const amountReadOnly = mode !== "deposit";
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex flex-wrap items-center justify-end gap-1">
          <Input
            className="w-28"
            type="number"
            step="0.01"
            placeholder={t("finance.institutional.field.amount")}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            readOnly={amountReadOnly}
          />
          <Input className="w-28" placeholder={t("finance.institutional.field.method")} value={method} onChange={(e) => setMethod(e.target.value)} />
          <Input
            className="w-28"
            placeholder={t("finance.institutional.field.reference_no")}
            value={referenceNo}
            onChange={(e) => setReferenceNo(e.target.value)}
          />
          <Button size="sm" disabled={isPending} onClick={submitPayment}>
            {t("finance.institutional.action.confirm")}
          </Button>
          <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setMode(null)}>
            {t("finance.institutional.action.cancel")}
          </Button>
        </div>
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {(row.invoice_id || row.latest_payment_id) && viewLinks}
      <div className="flex flex-wrap justify-end gap-2">
        {row.state === "no_invoice" && (
          <>
            <Button size="sm" disabled={isPending} onClick={doIssueInvoice}>
              {t("finance.institutional.action.issue_invoice")}
            </Button>
            <Button size="sm" variant="secondary" disabled={isPending} onClick={() => openPaymentForm("deposit", null)}>
              {t("finance.institutional.action.record_deposit")}
            </Button>
          </>
        )}
        {row.state === "invoiced_awaiting_payment" && (
          <Button size="sm" disabled={isPending} onClick={() => openPaymentForm("full_payment", row.ar_balance)}>
            {t("finance.institutional.action.record_full_payment")}
          </Button>
        )}
        {row.state === "deposit_received_awaiting_settlement" && (
          <>
            <Button size="sm" variant="secondary" disabled={isPending} onClick={() => openPaymentForm("deposit", null)}>
              {t("finance.institutional.action.record_deposit")}
            </Button>
            <Button size="sm" disabled={isPending} onClick={doIssueFinalSettlement}>
              {t("finance.institutional.action.issue_final_settlement")}
            </Button>
          </>
        )}
        {row.state === "settled_awaiting_final_payment" && (
          <Button size="sm" disabled={isPending} onClick={() => openPaymentForm("final_payment", row.ar_balance)}>
            {t("finance.institutional.action.record_final_payment")}
          </Button>
        )}
      </div>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
      {row.state === "deposit_received_awaiting_settlement" && row.deposit_balance > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("finance.institutional.column.deposit_balance")}: {formatMYR(row.deposit_balance)}
        </p>
      )}
    </div>
  );
}
