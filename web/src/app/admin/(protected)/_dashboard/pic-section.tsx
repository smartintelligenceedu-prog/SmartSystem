import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent } from "@/components/ui/card";
import { t } from "@/lib/i18n";

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

  const [title, descriptionPrefix, descriptionSuffix] = await Promise.all([
    t("dashboard.pic.title"),
    t("dashboard.pic.description_prefix"),
    t("dashboard.pic.description_suffix"),
  ]);

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            {descriptionPrefix}<span className="font-medium text-foreground">{campaignCount ?? 0}</span>{descriptionSuffix}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
