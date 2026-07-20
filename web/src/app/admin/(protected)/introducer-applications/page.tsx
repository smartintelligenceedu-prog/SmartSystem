import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { listIntroducerApplications, type IntroducerApplicationStatus } from "./data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CopyLinkButton } from "../_components/copy-link-button";
import { ReviewRowActions } from "./review-row-actions";
import { t, type TranslationKey } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const STATUS_KEY: Record<IntroducerApplicationStatus, TranslationKey> = {
  pending: "introducer_applications.status.pending",
  approved: "introducer_applications.status.approved",
  rejected: "introducer_applications.status.rejected",
};

const STATUS_VARIANT: Record<IntroducerApplicationStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "default",
  approved: "secondary",
  rejected: "destructive",
};

const TAB_VALUES: (IntroducerApplicationStatus | "all")[] = ["pending", "approved", "rejected", "all"];
const TAB_KEY: Record<(typeof TAB_VALUES)[number], TranslationKey> = {
  pending: "introducer_applications.status.pending",
  approved: "introducer_applications.status.approved",
  rejected: "introducer_applications.status.rejected",
  all: "introducer_applications.tab.all",
};

export default async function IntroducerApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const context = await getPortalUserContext();
  if (!isBackOfficeRole(context)) {
    redirect("/admin");
  }

  const { status } = await searchParams;
  const activeStatus = (status as IntroducerApplicationStatus | undefined) ?? "pending";
  const rows = await listIntroducerApplications(activeStatus === ("all" as never) ? undefined : activeStatus);

  const statusLabelByStatus = Object.fromEntries(
    await Promise.all(Object.entries(STATUS_KEY).map(async ([k, key]) => [k, await t(key)]))
  ) as Record<IntroducerApplicationStatus, string>;
  const tabLabelByValue = Object.fromEntries(
    await Promise.all(Object.entries(TAB_KEY).map(async ([k, key]) => [k, await t(key)]))
  ) as Record<(typeof TAB_VALUES)[number], string>;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{await t("introducer_applications.page.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{await t("introducer_applications.page.subtitle")}</p>
        </div>
        <CopyLinkButton path="/register-introducer" label={await t("introducer_applications.page.copy_link")} />
      </div>

      <nav className="mt-4 flex gap-1 border-b">
        {TAB_VALUES.map((value) => (
          <Link
            key={value}
            href={`/admin/introducer-applications?status=${value}`}
            className={`px-3 py-2 text-sm ${
              activeStatus === value ? "border-b-2 border-foreground font-medium" : "text-muted-foreground"
            }`}
          >
            {tabLabelByValue[value]}
          </Link>
        ))}
      </nav>

      <div className="mt-4 overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{await t("introducer_applications.page.column.name")}</TableHead>
              <TableHead>{await t("introducer_applications.page.column.contact")}</TableHead>
              <TableHead>{await t("introducer_applications.page.column.sponsor")}</TableHead>
              <TableHead>{await t("introducer_applications.page.column.status")}</TableHead>
              <TableHead>{await t("introducer_applications.page.column.submitted_at")}</TableHead>
              <TableHead>{await t("introducer_applications.page.column.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {await t("introducer_applications.page.empty")}
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.full_name}</TableCell>
                <TableCell className="text-muted-foreground">
                  <div>{row.email}</div>
                  <div>{row.phone}</div>
                </TableCell>
                <TableCell className="text-muted-foreground">{row.sponsor_name ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[row.status]}>{statusLabelByStatus[row.status]}</Badge>
                  {row.rejection_reason && <p className="mt-1 text-xs text-muted-foreground">{row.rejection_reason}</p>}
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">{new Date(row.created_at).toLocaleString("zh-CN")}</TableCell>
                <TableCell>{row.status === "pending" && <ReviewRowActions applicationId={row.id} />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
