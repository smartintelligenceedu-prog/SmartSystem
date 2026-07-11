import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { listAllCommissions } from "./data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AdjustCommissionCell } from "./adjust-commission-cell";

export const dynamic = "force-dynamic";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

const TRIGGER_LABEL: Record<string, string> = {
  personal_sale: "个人销售",
  pic_channel: "通路销售（PIC）",
  introducer: "引荐人佣金",
  recruitment: "招募佣金",
  voucher_resale: "兑换券转售",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  approved: "已核准",
  paid: "已发放",
  reversed: "已冲销",
};

interface SelfCommissionRow {
  id: string;
  trigger_type: string;
  calculation_type: string;
  rate_applied: number | null;
  base_amount: number;
  commission_amount: number;
  original_amount: number | null;
  status: string;
  calculated_at: string;
  adjustment_reason: string | null;
}

export default async function CommissionPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");

  const isBackOffice = isBackOfficeRole(context);
  const canSelfView = !!context.analystId || !!context.introducerId;
  if (!isBackOffice && !canSelfView) redirect("/admin");

  if (isBackOffice) {
    const rows = await listAllCommissions();
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold">佣金</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            全公司最近 {rows.length} 笔佣金记录。金额可人工调整（保留原始计算金额与调整原因，供稽核）。
          </p>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日期</TableHead>
                <TableHead>对象</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>计算方式</TableHead>
                <TableHead>金额</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>调整</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    尚无佣金记录
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {new Date(r.calculated_at).toLocaleDateString("zh-CN")}
                  </TableCell>
                  <TableCell>
                    {r.payee_name}
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({r.payee_type === "introducer" ? "引荐人" : "分析师"})
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{TRIGGER_LABEL[r.trigger_type] ?? r.trigger_type}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.calculation_type === "flat" ? "固定金额" : `${r.rate_applied}%`}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatMYR(r.commission_amount)}
                    {r.original_amount !== null && (
                      <div className="text-xs text-muted-foreground">原 {formatMYR(r.original_amount)}</div>
                    )}
                    {r.adjustment_reason && <div className="text-xs text-muted-foreground">{r.adjustment_reason}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.status === "paid" ? "secondary" : "outline"}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <AdjustCommissionCell recordId={r.id} currentAmount={r.commission_amount} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  // Self-view: plain RLS-scoped read (analyst_id = current_analyst_id() or
  // introducer_id = current_introducer_id() — see commission_records policy
  // in rls_policies.sql), same as every other self-scope query in this app.
  const supabase = await createServerSupabaseClient();
  const query = supabase
    .from("commission_records")
    .select("id, trigger_type, calculation_type, rate_applied, base_amount, commission_amount, original_amount, status, calculated_at, adjustment_reason")
    .order("calculated_at", { ascending: false })
    .limit(100);
  const { data } = context.analystId
    ? await query.eq("analyst_id", context.analystId)
    : await query.eq("introducer_id", context.introducerId as string);
  const rows = (data ?? []) as SelfCommissionRow[];

  const total = rows.reduce((sum, r) => sum + r.commission_amount, 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">我的佣金</h1>
        <p className="mt-1 text-sm text-muted-foreground">最近 {rows.length} 笔，累计 {formatMYR(total)}</p>
      </div>
      <div className="divide-y rounded-md border">
        {rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">目前没有佣金记录</p>}
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <div>
              <p>{TRIGGER_LABEL[r.trigger_type] ?? r.trigger_type}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(r.calculated_at).toLocaleDateString("zh-CN")} ·{" "}
                {r.calculation_type === "flat" ? "固定金额" : `${r.rate_applied}% of ${formatMYR(r.base_amount)}`}
              </p>
              {r.adjustment_reason && <p className="text-xs text-muted-foreground">已调整：{r.adjustment_reason}</p>}
            </div>
            <div className="flex items-center gap-3">
              <span className="tabular-nums">{formatMYR(r.commission_amount)}</span>
              <Badge variant={r.status === "paid" ? "secondary" : "outline"}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
