import { createAdminClient } from "@/lib/supabase/admin";
import type { RegistrationKit } from "@/lib/types/registration";
import { RegisterForm } from "./register-form";
import { Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { getCompanyInfo } from "@/app/admin/(protected)/settings/data";
import { t } from "@/lib/i18n";

// Kit pricing/availability is live data, not something to bake into the
// static build — and this also avoids next build trying to execute the
// Supabase call (and needing real env vars) at build time.
export const dynamic = "force-dynamic";

// Kit browsing happens before the visitor has any Supabase Auth session, so
// there is no RLS-respecting client to read it through yet (see
// database/rls_policies.sql — anon has zero direct table access by design).
// This is a public product listing, not sensitive data, so reading it via
// the admin client server-side is the right tradeoff rather than opening
// registration_kits up to the anon role.
async function getActiveKits(): Promise<RegistrationKit[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("registration_kits")
    .select("id, name, price, voucher_self_use_count, voucher_resale_count, includes_business_card, is_active")
    .eq("is_active", true)
    .order("price", { ascending: true });

  if (error) {
    throw new Error(`${await t("register.load_error_prefix")}${error.message}`);
  }
  return data ?? [];
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const [kits, companyInfo, { ref }] = await Promise.all([getActiveKits(), getCompanyInfo(), searchParams]);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <div className="mb-6 flex items-center justify-between">
        <Logo />
        <LocaleSwitcher />
      </div>
      <div className="mb-8">
        <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          {await t("register.eyebrow")}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{await t("register.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {await t("register.subtitle")}
        </p>
      </div>

      {kits.length === 0 ? (
        <p className="text-sm text-destructive">{await t("register.no_kits")}</p>
      ) : (
        <RegisterForm kits={kits} agreementUrl={companyInfo.agreementUrl} sponsorReferralCode={ref} />
      )}
    </main>
  );
}
