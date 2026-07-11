import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent } from "@/components/ui/card";

// PIC is scaffolded but not fully activated yet per the Phase 3 scope
// decision — channel_campaigns exists in the schema (from the Registration
// Module's commission engine) but there's no campaign management UI yet.
// This just proves the role plumbing works end to end.
export async function PicSection({ analystId }: { analystId: string }) {
  const admin = createAdminClient();
  const { count: campaignCount } = await admin
    .from("channel_campaigns")
    .select("id", { count: "exact", head: true })
    .eq("pic_analyst_id", analystId);

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">通路开发（PIC）</h2>
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            PIC 功能尚未完全启用。目前你名下有 <span className="font-medium text-foreground">{campaignCount ?? 0}</span> 个通路开发活动（校园/机构/roadshow）。完整的活动管理界面会在未来阶段开放。
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
