import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getPortalUserContext } from "@/lib/auth/context";
import { Sidebar } from "./_components/sidebar";
import { Header } from "./_components/header";

// This is the authoritative authorization check (proxy.ts only checks "is
// there a session" for UX redirect convenience — see the comment there).
// Runs once per navigation into the (protected) group.
//
// Gate is "has at least one Portal role" now, not is_back_office() — Agents,
// Leaders, Introducers, and PICs all log in here too as of Phase 3. A user
// with zero role rows (e.g. an analyst who was created but never had a role
// granted) is treated as not provisioned yet, same as a missing profile.
export default async function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
  }

  const context = await getPortalUserContext();
  if (!context) {
    const { data: userRow } = await supabase.from("users").select("status").eq("auth_user_id", user.id).maybeSingle();
    if (userRow?.status === "suspended") {
      redirect("/admin/login?error=suspended");
    }
    redirect("/admin/login?error=incomplete_profile");
  }
  if (context.roles.length === 0) {
    redirect("/admin/login?error=not_authorized");
  }

  return (
    <div className="flex min-h-screen">
      <div className="print:hidden">
        <Sidebar context={context} />
      </div>
      <div className="flex flex-1 flex-col">
        <div className="print:hidden">
          <Header context={context} />
        </div>
        <main className="flex-1 px-6 py-8 print:p-0">{children}</main>
      </div>
    </div>
  );
}
