import Link from "next/link";
import { listRegistrations } from "./data";
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

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<AnalystStatus, string> = {
  pending: "待审核",
  approved: "已核准",
  suspended: "已暂停",
  rejected: "已拒绝",
  terminated: "已终止",
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

const TABS: { value: AnalystStatus | "all"; label: string }[] = [
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已核准" },
  { value: "suspended", label: "已暂停" },
  { value: "rejected", label: "已拒绝" },
  { value: "all", label: "全部" },
];

export default async function RegistrationsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const activeStatus = (status as AnalystStatus | undefined) ?? "pending";
  const rows = await listRegistrations(activeStatus === ("all" as never) ? undefined : activeStatus);

  return (
    <main className="mx-auto max-w-5xl">
      <h1 className="text-xl font-semibold">分析师注册审核</h1>

      <nav className="mt-4 flex gap-1 border-b">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/admin/registrations?status=${tab.value}`}
            className={`px-3 py-2 text-sm ${
              activeStatus === tab.value
                ? "border-b-2 border-foreground font-medium"
                : "text-muted-foreground"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="mt-4 overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>姓名</TableHead>
              <TableHead>昵称</TableHead>
              <TableHead>联络方式</TableHead>
              <TableHead>推荐人</TableHead>
              <TableHead>套装</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>提交时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  没有符合的申请
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
                  <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {new Date(row.created_at).toLocaleString("zh-CN")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </main>
  );
}
