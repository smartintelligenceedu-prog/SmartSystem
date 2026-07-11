import { redirect } from "next/navigation";
import Link from "next/link";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { listCustomers } from "./data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

function formatMYR(amount: number) {
  return new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR" }).format(amount);
}

export default async function CustomersPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  const isBackOffice = isBackOfficeRole(context);
  if (!context.analystId && !isBackOffice) redirect("/admin");

  const customers = await listCustomers(isBackOffice);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">顾客</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isBackOffice ? "全公司顾客名单" : "你名下的顾客"}
          </p>
        </div>
        {context.analystId && <Button size="sm" render={<Link href="/admin/customers/new">登记新顾客</Link>} />}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>姓名</TableHead>
              <TableHead>联络方式</TableHead>
              {isBackOffice && <TableHead>负责分析师</TableHead>}
              <TableHead>来源引荐人</TableHead>
              <TableHead>订单数</TableHead>
              <TableHead>累计消费</TableHead>
              <TableHead>状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.length === 0 && (
              <TableRow>
                <TableCell colSpan={isBackOffice ? 7 : 6} className="text-center text-muted-foreground">
                  {isBackOffice ? "尚无顾客资料" : "你还没有登记任何顾客"}
                </TableCell>
              </TableRow>
            )}
            {customers.map((c) => (
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
                    {c.status === "active" ? "启用中" : "已停用"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
