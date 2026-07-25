import { createAdminClient } from "@/lib/supabase/admin";
import { Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { t } from "@/lib/i18n";
import { LeadForm } from "./lead-form";

export const dynamic = "force-dynamic";

// Public, unauthenticated — same reasoning as /register reading
// registration_kits via the admin client: there's no RLS-respecting session
// yet at this point, and a referral_code lookup by itself isn't sensitive.
// Accepts either an introducer's or an agent's own referral_code — an agent's
// "leads" link lets a customer submit an enquiry straight to them, with no
// introducer in the middle (see submitLead() for how the two are told apart).
async function isValidReferCode(code: string): Promise<boolean> {
  const admin = createAdminClient();
  const [{ data: introducer }, { data: analyst }] = await Promise.all([
    admin.from("introducers").select("id").eq("referral_code", code).eq("status", "active").maybeSingle(),
    admin.from("analysts").select("id").eq("referral_code", code).eq("status", "approved").maybeSingle(),
  ]);
  return !!introducer || !!analyst;
}

export default async function ReferPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const valid = await isValidReferCode(code);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="mb-6 flex items-center justify-between">
        <Logo />
        <LocaleSwitcher />
      </div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">{await t("refer.page.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{await t("refer.page.subtitle")}</p>
      </div>

      {valid ? <LeadForm code={code} /> : <p className="text-sm text-destructive">{await t("refer.page.invalid_link")}</p>}
    </main>
  );
}
