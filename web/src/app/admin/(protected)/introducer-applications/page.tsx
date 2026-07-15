import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { listIntroducerApplications, type IntroducerApplicationStatus } from "./data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CopyLinkButton } from "../_components/copy-link-button";
import { ReviewRowActions } from "./review-row-actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<IntroducerApplicationStatus, string> = {
  pending: "待审核",
  approved: "已核准",
  rejected: "已拒绝",
};

const STATUS_VARIANT: Record<IntroducerApplicationStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "default",
  approved: "secondary",
  rejected: "destructive",
};

const TABS: { value: IntroducerApplicationStatus | "all"; label: string }[] = [
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已核准" },
  { value: "rejected", label: "已拒绝" },
  { value: "all", label: "全部" },
];

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

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">引荐人申请</h1>
          <p className="mt-1 text-sm text-muted-foreground">公开申请连结提交的引荐人申请，审核通过后会自动建立引荐人档案。</p>
        </div>
        <CopyLinkButton path="/register-introducer" label="复制申请连结" />
      </div>

      <nav className="mt-4 flex gap-1 border-b">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/admin/introducer-applications?status=${tab.value}`}
            className={`px-3 py-2 text-sm ${
              activeStatus === tab.value ? "border-b-2 border-foreground font-medium" : "text-muted-foreground"
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
              <TableHead>联络方式</TableHead>
              <TableHead>推荐人</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>提交时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  没有符合的申请
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
                  <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABEL[row.status]}</Badge>
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
