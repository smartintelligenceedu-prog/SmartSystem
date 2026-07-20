import Link from "next/link";
import { redirect } from "next/navigation";
import { listRegistrations } from "./data";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AnalystStatus } from "@/lib/types/registration";
import { CopyLinkButton } from "../_components/copy-link-button";
import { t, type TranslationKey } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const STATUS_KEY: Record<AnalystStatus, TranslationKey> = {
  pending: "dashboard.agent.status.pending",
  approved: "dashboard.agent.status.approved",
  suspended: "dashboard.agent.status.suspended",
  rejected: "dashboard.agent.status.rejected",
  terminated: "dashboard.agent.status.terminated",
};

const STATUS_VARIANT: Record<AnalystStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "default",
  approved: "secondary",
  suspended: "outline",
  rejected: "destructive",
  terminated: "destructive",
};

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

const TAB_VALUES = ["pending", "approved", "suspended", "rejected", "all"] as const;
const TAB_KEY: Record<(typeof TAB_VALUES)[number], TranslationKey> = {
  pending: "dashboard.agent.status.pending",
  approved: "dashboard.agent.status.approved",
  suspended: "dashboard.agent.status.suspended",
  rejected: "dashboard.agent.status.rejected",
  all: "registrations.tab.all",
};

export default async function RegistrationsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  // This page renders other people's IC documents, payment screenshots, and
  // bank details — back-office only. The (protected) layout only checks
  // "has at least one Portal role", which as of Phase 3 also lets Agents/
  // Leaders/Introducers in, so every page needs its own gate for who
  // specifically may see it.
  const context = await getPortalUserContext();
  if (!isBackOfficeRole(context)) {
    redirect("/admin");
  }

  const { status } = await searchParams;
  const activeStatus = (status as AnalystStatus | undefined) ?? "pending";
  const rows = await listRegistrations(activeStatus === ("all" as never) ? undefined : activeStatus);

  const statusLabelByStatus = Object.fromEntries(
    await Promise.all(Object.entries(STATUS_KEY).map(async ([k, key]) => [k, await t(key)]))
  ) as Record<AnalystStatus, string>;
  const tabLabelByValue = Object.fromEntries(
    await Promise.all(Object.entries(TAB_KEY).map(async ([k, key]) => [k, await t(key)]))
  ) as Record<(typeof TAB_VALUES)[number], string>;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold">{await t("registrations.page.title")}</h1>
        <CopyLinkButton path="/register" label={await t("registrations.page.copy_link")} />
      </div>

      <nav className="mt-4 flex gap-1 border-b">
        {TAB_VALUES.map((value) => (
          <Link
            key={value}
            href={`/admin/registrations?status=${value}`}
            className={`px-3 py-2 text-sm ${
              activeStatus === value
                ? "border-b-2 border-foreground font-medium"
                : "text-muted-foreground"
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
              <TableHead>{await t("registrations.page.column.name")}</TableHead>
              <TableHead>{await t("registrations.page.column.nickname")}</TableHead>
              <TableHead>{await t("registrations.page.column.contact")}</TableHead>
              <TableHead>{await t("registrations.page.column.sponsor")}</TableHead>
              <TableHead>{await t("registrations.page.column.kit")}</TableHead>
              <TableHead>{await t("registrations.page.column.status")}</TableHead>
              <TableHead>{await t("registrations.page.column.submitted_at")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  {await t("registrations.page.empty")}
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.analyst_id}>
                <TableCell>
                  <Link href={`/admin/registrations/${row.analyst_id}`} className="font-medium hover:underline">
                    {row.full_name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{row.nickname ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  <div>{row.email}</div>
                  <div>{row.phone}</div>
                </TableCell>
                <TableCell className="text-muted-foreground">{row.sponsor_name ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {row.kit_name} · {formatMYR(row.price)}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[row.status]}>{statusLabelByStatus[row.status]}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {new Date(row.created_at).toLocaleString("zh-CN")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
