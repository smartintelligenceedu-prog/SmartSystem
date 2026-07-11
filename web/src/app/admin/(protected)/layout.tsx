import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getPortalUserContext } from "@/lib/auth/context";
import { Sidebar } from "./_components/sidebar";
import { Header } from "./_components/header";

// This is the authoritative authorization check (proxy.ts only checks "is
// there a session" for UX redirect convenience — see the comment there).
// Runs once per navigation into the (protected) group.
export default async function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
  }

  const { data: isBackOffice } = await supabase.rpc("is_back_office");
  if (!isBackOffice) {
    redirect("/admin/login?error=not_authorized");
  }

  const context = await getPortalUserContext();
  if (!context) {
    // is_back_office() passed but there's no linked party/individual record —
    // a data setup problem, not a permissions one. Surface it rather than
    // silently rendering a blank shell.
    redirect("/admin/login?error=incomplete_profile");
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar isAdmin={context.roles.includes("admin")} />
      <div className="flex flex-1 flex-col">
        <Header context={context} />
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
