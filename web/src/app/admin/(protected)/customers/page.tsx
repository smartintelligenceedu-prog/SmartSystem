import { redirect } from "next/navigation";
import Link from "next/link";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { listCustomers, listApprovedAgentsForFilter, listActiveIntroducersForAttribution } from "./data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArchiveCustomerButton } from "./archive-customer-button";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

interface SearchParams {
  search?: string;
  status?: string;
  agent?: string;
  introducer?: string;
  from?: string;
  to?: string;
  page?: string;
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  const isBackOffice = isBackOfficeRole(context);
  if (!context.analystId && !context.introducerId && !isBackOffice) redirect("/admin");

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ rows, totalCount, pageSize }, agents, introducers] = await Promise.all([
    listCustomers(isBackOffice, {
      search: sp.search,
      status: sp.status === "active" || sp.status === "inactive" ? sp.status : undefined,
      ownerAnalystId: sp.agent || undefined,
      introducerId: sp.introducer || undefined,
      createdFrom: sp.from || undefined,
      createdTo: sp.to || undefined,
      page,
    }),
    isBackOffice ? listApprovedAgentsForFilter() : Promise.resolve([]),
    isBackOffice ? listActiveIntroducersForAttribution() : Promise.resolve([]),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const canManageRow = (ownerAnalystId: string) => isBackOffice || ownerAnalystId === context.analystId;

  const subtitle = isBackOffice
    ? t("customer.list.subtitle_all")
    : context.analystId
      ? t("customer.list.subtitle_own")
      : t("customer.list.subtitle_introducer");

  function pageHref(targetPage: number) {
    const params = new URLSearchParams();
    if (sp.search) params.set("search", sp.search);
    if (sp.status) params.set("status", sp.status);
    if (sp.agent) params.set("agent", sp.agent);
    if (sp.introducer) params.set("introducer", sp.introducer);
    if (sp.from) params.set("from", sp.from);
    if (sp.to) params.set("to", sp.to);
    params.set("page", String(targetPage));
    return `/admin/customers?${params.toString()}`;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t("customer.list.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {context.analystId && <Button size="sm" render={<Link href="/admin/customers/new">{t("customer.list.create_button")}</Link>} />}
      </div>

      <form method="get" action="/admin/customers" className="flex flex-wrap items-end gap-3 rounded-md border p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">{t("customer.list.search_placeholder")}</label>
          <input
            name="search"
            defaultValue={sp.search}
            placeholder={t("customer.list.search_placeholder")}
            className="h-9 w-56 rounded-md border bg-background px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">{t("customer.list.filter.status")}</label>
          <select name="status" defaultValue={sp.status ?? ""} className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="">{t("customer.list.filter.status_all")}</option>
            <option value="active">{t("customer.list.filter.status_active")}</option>
            <option value="inactive">{t("customer.list.filter.status_inactive")}</option>
          </select>
        </div>
        {isBackOffice && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t("customer.list.filter.agent")}</label>
            <select name="agent" defaultValue={sp.agent ?? ""} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">{t("customer.list.filter.agent_all")}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {isBackOffice && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t("customer.list.filter.introducer")}</label>
            <select name="introducer" defaultValue={sp.introducer ?? ""} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">{t("customer.list.filter.introducer_all")}</option>
              {introducers.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">{t("customer.list.filter.date_from")}</label>
          <input type="date" name="from" defaultValue={sp.from} className="h-9 rounded-md border bg-background px-2 text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">{t("customer.list.filter.date_to")}</label>
          <input type="date" name="to" defaultValue={sp.to} className="h-9 rounded-md border bg-background px-2 text-sm" />
        </div>
        <Button size="sm" type="submit">
          {t("customer.list.filter.apply")}
        </Button>
        <Button size="sm" variant="ghost" render={<Link href="/admin/customers">{t("customer.list.filter.reset")}</Link>} />
      </form>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("customer.list.column.name")}</TableHead>
              <TableHead>{t("customer.list.column.contact")}</TableHead>
              {isBackOffice && <TableHead>{t("customer.list.column.agent")}</TableHead>}
              <TableHead>{t("customer.list.column.introducer")}</TableHead>
              <TableHead>{t("customer.list.column.orders")}</TableHead>
              <TableHead>{t("customer.list.column.spent")}</TableHead>
              <TableHead>{t("customer.list.column.status")}</TableHead>
              <TableHead>{t("customer.list.column.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={isBackOffice ? 8 : 7} className="text-center text-muted-foreground">
                  {t("customer.list.empty")}
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => (
              <TableRow key={c.customer_id}>
                <TableCell>{c.full_name}</TableCell>
                <TableCell className="text-muted-foreground">
                  <div>{c.phone}</div>
                  <div>{c.email}</div>
                </TableCell>
                {isBackOffice && <TableCell className="text-muted-foreground">{c.owner_name}</TableCell>}
                <TableCell className="text-muted-foreground">{c.introducer_name ?? "—"}</TableCell>
                <TableCell className="tabular-nums">{c.order_count}</TableCell>
                <TableCell className="tabular-nums">{formatMYR(c.total_spent)}</TableCell>
                <TableCell>
                  <Badge variant={c.status === "active" ? "secondary" : "outline"}>
                    {c.status === "active" ? t("customer.status.active") : t("customer.status.inactive")}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" render={<Link href={`/admin/customers/${c.customer_id}`}>{t("customer.list.action.view")}</Link>} />
                    {canManageRow(c.owner_analyst_id) && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          render={<Link href={`/admin/customers/${c.customer_id}/edit`}>{t("customer.list.action.edit")}</Link>}
                        />
                        <ArchiveCustomerButton customerId={c.customer_id} isArchived={c.status === "inactive"} />
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Button size="sm" variant="outline" render={<Link href={pageHref(page - 1)}>{t("customer.list.pagination.prev")}</Link>} />
          ) : (
            <Button size="sm" variant="outline" disabled>
              {t("customer.list.pagination.prev")}
            </Button>
          )}
          <span className="text-muted-foreground">
            {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Button size="sm" variant="outline" render={<Link href={pageHref(page + 1)}>{t("customer.list.pagination.next")}</Link>} />
          ) : (
            <Button size="sm" variant="outline" disabled>
              {t("customer.list.pagination.next")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
