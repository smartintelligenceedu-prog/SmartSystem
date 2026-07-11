import { createAdminClient } from "@/lib/supabase/admin";
import type { RegistrationKit } from "@/lib/types/registration";
import { RegisterForm } from "./register-form";
import { Logo } from "@/components/logo";

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
    throw new Error(`无法载入注册套装：${error.message}`);
  }
  return data ?? [];
}

export default async function RegisterPage() {
  const kits = await getActiveKits();

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <Logo className="mb-6" />
      <div className="mb-8">
        <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          TQC 分析师注册
        </p>
        <h1 className="mt-1 text-2xl font-semibold">加入成为 TQC 分析师</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          完成注册并缴付套装费用后，即可开始培训认证流程。
        </p>
      </div>

      {kits.length === 0 ? (
        <p className="text-sm text-destructive">目前没有开放中的注册套装，请联系公司后台。</p>
      ) : (
        <RegisterForm kits={kits} />
      )}
    </main>
  );
}
