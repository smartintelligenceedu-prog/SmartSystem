import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { listIntroducers, listActiveIntroducersForSponsorPicker, listApprovedAnalystsForAssignment } from "./data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { IntroducerLoginCell } from "./introducer-login-cell";
import { AssignedAnalystCell } from "./assigned-analyst-cell";
import { CreateIntroducerForm } from "./create-introducer-form";

export const dynamic = "force-dynamic";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

export default async function IntroducersPage() {
  const context = await getPortalUserContext();
  if (!isBackOfficeRole(context)) {
    redirect("/admin");
  }

  const [introducers, sponsors, analysts] = await Promise.all([
    listIntroducers(),
    listActiveIntroducersForSponsorPicker(),
    listApprovedAnalystsForAssignment(),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold">引荐人管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Introducer 不属于分析师体系，是外部顾客来源渠道；引荐人也可以介绍别的引荐人，两层都能拿佣金。
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>姓名</TableHead>
              <TableHead>联络方式</TableHead>
              <TableHead>上线引荐人</TableHead>
              <TableHead>推荐码</TableHead>
              <TableHead>负责分析师</TableHead>
              <TableHead>已引荐顾客</TableHead>
              <TableHead>累计奖金</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>登入帐号</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {introducers.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  尚未建立任何引荐人
                </TableCell>
              </TableRow>
            )}
            {introducers.map((row) => (
              <TableRow key={row.introducer_id}>
                <TableCell>{row.full_name}</TableCell>
                <TableCell className="text-muted-foreground">
                  <div>{row.email}</div>
                  <div>{row.phone}</div>
                </TableCell>
                <TableCell className="text-muted-foreground">{row.sponsor_name ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{row.referral_code}</TableCell>
                <TableCell>
                  <AssignedAnalystCell
                    introducerId={row.introducer_id}
                    currentAnalystId={row.assigned_analyst_id}
                    currentAnalystName={row.assigned_analyst_name}
                    analysts={analysts}
                  />
                </TableCell>
                <TableCell className="tabular-nums">{row.total_introduced_customers}</TableCell>
                <TableCell className="tabular-nums">{formatMYR(row.total_bonus)}</TableCell>
                <TableCell>
                  <Badge variant={row.status === "active" ? "secondary" : "outline"}>
                    {row.status === "active" ? "启用中" : "已停用"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <IntroducerLoginCell introducerId={row.introducer_id} hasLogin={row.has_login} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">新增引荐人</h2>
        <CreateIntroducerForm sponsors={sponsors} analysts={analysts} />
      </div>
    </div>
  );
}
