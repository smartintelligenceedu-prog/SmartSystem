import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { listLeads } from "./data";
import { listApprovedAnalystsForAssignment } from "../introducers/data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { LeadActionsCell } from "./lead-actions-cell";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const STATUS_BADGE_VARIANT: Record<string, "secondary" | "outline" | "default" | "destructive"> = {
  new: "outline",
  contacted: "secondary",
  converted: "default",
  lost: "destructive",
};

const STATUS_LABEL_KEY: Record<string, "leads.status.new" | "leads.status.contacted" | "leads.status.converted" | "leads.status.lost"> = {
  new: "leads.status.new",
  contacted: "leads.status.contacted",
  converted: "leads.status.converted",
  lost: "leads.status.lost",
};

export default async function LeadsPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  const isBackOffice = isBackOfficeRole(context);
  if (!context.analystId && !isBackOffice) redirect("/admin");

  const [leads, analysts] = await Promise.all([listLeads(isBackOffice), isBackOffice ? listApprovedAnalystsForAssignment() : Promise.resolve([])]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t("leads.page.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isBackOffice ? t("leads.page.subtitle_back_office") : t("leads.page.subtitle_analyst")}
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("leads.table.name")}</TableHead>
              <TableHead>{t("leads.table.phone")}</TableHead>
              <TableHead>{t("leads.table.introducer")}</TableHead>
              {isBackOffice && <TableHead>{t("leads.table.assigned_analyst")}</TableHead>}
              <TableHead>{t("leads.table.status")}</TableHead>
              <TableHead>{t("leads.table.created_at")}</TableHead>
              <TableHead>{t("leads.table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.length === 0 && (
              <TableRow>
                <TableCell colSpan={isBackOffice ? 7 : 6} className="text-center text-muted-foreground">
                  {t("leads.table.empty")}
                </TableCell>
              </TableRow>
            )}
            {leads.map((lead) => (
              <TableRow key={lead.id}>
                <TableCell>{lead.contact_name}</TableCell>
                <TableCell className="text-muted-foreground">{lead.phone ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{lead.introducer_name ?? "—"}</TableCell>
                {isBackOffice && <TableCell className="text-muted-foreground">{lead.assigned_analyst_name ?? "—"}</TableCell>}
                <TableCell>
                  <Badge variant={STATUS_BADGE_VARIANT[lead.status]}>{t(STATUS_LABEL_KEY[lead.status])}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {new Date(lead.created_at).toLocaleDateString("zh-CN")}
                </TableCell>
                <TableCell>
                  <LeadActionsCell lead={lead} isBackOffice={isBackOffice} analysts={analysts} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
