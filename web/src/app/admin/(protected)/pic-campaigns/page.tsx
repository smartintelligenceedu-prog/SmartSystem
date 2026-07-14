import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { hasAnyRole } from "@/lib/auth/roles";
import { listCampaigns, listApprovedAnalystOptions } from "./data";
import { CreateCampaignForm } from "./create-campaign-form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const TYPE_LABEL_KEY: Record<string, Parameters<typeof t>[0]> = {
  school: "pic_campaigns.type.school",
  institution: "pic_campaigns.type.institution",
  roadshow: "pic_campaigns.type.roadshow",
  other: "pic_campaigns.type.other",
};

function formatMYR(amount: number | null) {
  if (amount === null) return null;
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

export default async function PicCampaignsPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!hasAnyRole(context, ["admin", "finance"])) redirect("/admin");

  const [campaigns, analysts] = await Promise.all([listCampaigns(), listApprovedAnalystOptions()]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t("pic_campaigns.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("pic_campaigns.subtitle")}</p>
      </div>

      <CreateCampaignForm analysts={analysts} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("pic_campaigns.column.name")}</TableHead>
            <TableHead>{t("pic_campaigns.column.type")}</TableHead>
            <TableHead>{t("pic_campaigns.column.pic")}</TableHead>
            <TableHead>{t("pic_campaigns.column.report_override")}</TableHead>
            <TableHead>{t("pic_campaigns.column.analyst_fee")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {campaigns.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                {t("pic_campaigns.empty")}
              </TableCell>
            </TableRow>
          )}
          {campaigns.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                {c.name}
                {c.location && <span className="ml-1 text-xs text-muted-foreground">· {c.location}</span>}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{t(TYPE_LABEL_KEY[c.campaign_type] ?? "pic_campaigns.type.other")}</Badge>
              </TableCell>
              <TableCell>{c.pic_name}</TableCell>
              <TableCell>{formatMYR(c.pic_report_override_amount) ?? <span className="text-xs text-muted-foreground">{t("pic_campaigns.uses_default")}</span>}</TableCell>
              <TableCell>{formatMYR(c.pic_analyst_report_fee_amount) ?? <span className="text-xs text-muted-foreground">{t("pic_campaigns.uses_default")}</span>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
