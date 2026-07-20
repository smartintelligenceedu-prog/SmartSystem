import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { listIntroducers, listActiveIntroducersForSponsorPicker, listApprovedAnalystsForAssignment } from "./data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { IntroducerLoginCell } from "./introducer-login-cell";
import { AssignedAnalystCell } from "./assigned-analyst-cell";
import { CreateIntroducerForm } from "./create-introducer-form";
import { t } from "@/lib/i18n";

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
  const activeStatusLabel = await t("introducers.page.status.active");
  const inactiveStatusLabel = await t("introducers.page.status.inactive");

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold">{await t("introducers.page.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{await t("introducers.page.subtitle")}</p>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{await t("introducers.page.column.name")}</TableHead>
              <TableHead>{await t("introducers.page.column.contact")}</TableHead>
              <TableHead>{await t("introducers.page.column.sponsor")}</TableHead>
              <TableHead>{await t("introducers.page.column.referral_code")}</TableHead>
              <TableHead>{await t("introducers.page.column.assigned_analyst")}</TableHead>
              <TableHead>{await t("introducers.page.column.referred_customers")}</TableHead>
              <TableHead>{await t("introducers.page.column.total_bonus")}</TableHead>
              <TableHead>{await t("introducers.page.column.status")}</TableHead>
              <TableHead>{await t("introducers.page.column.login")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {introducers.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  {await t("introducers.page.empty")}
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
                    {row.status === "active" ? activeStatusLabel : inactiveStatusLabel}
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
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("introducers.page.add_title")}</h2>
        <CreateIntroducerForm sponsors={sponsors} analysts={analysts} />
      </div>
    </div>
  );
}
