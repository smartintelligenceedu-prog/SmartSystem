import { createAdminClient } from "@/lib/supabase/admin";
import { Logo } from "@/components/logo";
import { t } from "@/lib/i18n";
import { LeadForm } from "./lead-form";

export const dynamic = "force-dynamic";

// Public, unauthenticated — same reasoning as /register reading
// registration_kits via the admin client: there's no RLS-respecting session
// yet at this point, and a referral_code lookup by itself isn't sensitive.
async function getIntroducerByCode(code: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from("introducers").select("id").eq("referral_code", code).eq("status", "active").maybeSingle();
  return !!data;
}

export default async function ReferPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const valid = await getIntroducerByCode(code);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <Logo className="mb-6" />
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">{t("refer.page.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("refer.page.subtitle")}</p>
      </div>

      {valid ? <LeadForm code={code} /> : <p className="text-sm text-destructive">{t("refer.page.invalid_link")}</p>}
    </main>
  );
}
