import { redirect, notFound } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasAnyRole } from "@/lib/auth/roles";
import { getPaymentDetail } from "../../data";
import { ISSUER } from "../../company-info";
import { t } from "@/lib/i18n";
import { PrintButton } from "../../print-button";

export const dynamic = "force-dynamic";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-MY", { year: "numeric", month: "long", day: "numeric" });
}

const PAYMENT_TYPE_KEY = {
  deposit: "finance.institutional.print.payment_type.deposit",
  full_payment: "finance.institutional.print.payment_type.full_payment",
  final_payment: "finance.institutional.print.payment_type.final_payment",
} as const;

export default async function ReceiptPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!hasAnyRole(context, ["admin", "finance"])) redirect("/admin");

  const payment = await getPaymentDetail(id);
  if (!payment) notFound();

  return (
    <div className="mx-auto max-w-3xl bg-white text-black print:max-w-none">
      <style>{`
        @page { size: A4; margin: 15mm; }
        @media print {
          .print-hidden { display: none !important; }
          body { background: white !important; }
        }
      `}</style>

      <div className="print-hidden mb-6">
        <PrintButton />
      </div>

      <div className="relative rounded-md border border-neutral-300 bg-white p-10 print:border-0 print:p-0">
        <div className="absolute top-8 right-10 -rotate-12 rounded border-4 border-emerald-600 px-4 py-1 text-2xl font-black tracking-widest text-emerald-600">
          {t("finance.institutional.print.paid_stamp")}
        </div>

        <div className="flex items-start justify-between border-b-4 border-black pb-6">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">{ISSUER.name}</h1>
            <p className="mt-1 text-sm text-neutral-600">{ISSUER.addressLine1}</p>
            <p className="text-sm text-neutral-600">{ISSUER.addressLine2}</p>
            <p className="mt-1 text-sm text-neutral-600">
              {t("finance.institutional.print.phone")}: {ISSUER.phone}
            </p>
            <p className="text-sm text-neutral-600">{ISSUER.email}</p>
            <p className="mt-1 text-sm text-neutral-600">
              {t("finance.institutional.print.ssm_no")}: {ISSUER.ssmNumber}
            </p>
          </div>
          <div className="text-right">
            <h2 className="text-3xl font-black tracking-wide">{t("finance.institutional.print.receipt_title")}</h2>
            <p className="mt-2 text-sm text-neutral-600">{t(PAYMENT_TYPE_KEY[payment.payment_type])}</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-8">
          <div>
            <p className="text-xs font-bold tracking-wide text-neutral-500 uppercase">{t("finance.institutional.print.bill_to")}</p>
            {payment.billing_entity ? (
              <div className="mt-2 text-sm">
                <p className="font-semibold">{payment.billing_entity.legal_name}</p>
                {payment.billing_entity.ssm_number && (
                  <p className="text-neutral-600">
                    {t("finance.institutional.print.ssm_no")}: {payment.billing_entity.ssm_number}
                  </p>
                )}
                <p className="text-neutral-600">
                  {[payment.billing_entity.address_line1, payment.billing_entity.address_line2].filter(Boolean).join(", ")}
                </p>
                <p className="text-neutral-600">
                  {[payment.billing_entity.postcode, payment.billing_entity.city, payment.billing_entity.state].filter(Boolean).join(" ")}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-neutral-400">—</p>
            )}
          </div>
          <div className="text-right">
            <div className="grid grid-cols-2 gap-x-4 text-sm">
              <span className="text-neutral-500">{t("finance.institutional.print.receipt_no")}</span>
              <span className="font-mono font-semibold">{payment.receipt_no ?? "—"}</span>
              <span className="text-neutral-500">{t("finance.institutional.print.date")}</span>
              <span>{formatDate(payment.paid_at)}</span>
              <span className="text-neutral-500">{t("finance.institutional.print.payment_method")}</span>
              <span>{payment.method}</span>
              {payment.reference_no && (
                <>
                  <span className="text-neutral-500">{t("finance.institutional.print.reference_no")}</span>
                  <span>{payment.reference_no}</span>
                </>
              )}
              {payment.responsible_analyst_name && (
                <>
                  <span className="text-neutral-500">{t("finance.institutional.print.responsible_person")}</span>
                  <span>{payment.responsible_analyst_name}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <table className="mt-8 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-black">
              <th className="py-2 text-left font-bold">{t("finance.institutional.print.description")}</th>
              <th className="py-2 text-right font-bold">{t("finance.institutional.print.quantity")}</th>
              <th className="py-2 text-right font-bold">{t("finance.institutional.print.unit_price")}</th>
              <th className="py-2 text-right font-bold">{t("finance.institutional.print.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {payment.line_items.map((li, i) => (
              <tr key={i} className="border-b border-neutral-200">
                <td className="py-3">{li.description}</td>
                <td className="py-3 text-right tabular-nums">{li.quantity}</td>
                <td className="py-3 text-right tabular-nums">{formatMYR(li.unit_price)}</td>
                <td className="py-3 text-right tabular-nums">{formatMYR(li.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 flex justify-end">
          <div className="w-64 space-y-2 text-sm">
            <div className="flex justify-between border-t-2 border-black pt-2 text-base font-bold">
              <span>{t("finance.institutional.print.amount_received")}</span>
              <span className="tabular-nums">{formatMYR(payment.amount)}</span>
            </div>
          </div>
        </div>

        <p className="mt-12 text-center text-xs text-neutral-500">{t("finance.institutional.print.thank_you")}</p>
      </div>
    </div>
  );
}
