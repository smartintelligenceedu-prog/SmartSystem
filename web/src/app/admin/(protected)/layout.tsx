import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Logo } from "@/components/logo";
import { signOut } from "../login/actions";
import { Button } from "@/components/ui/button";

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

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Logo />
        <form action={signOut}>
          <Button variant="ghost" size="sm" type="submit">
            登出
          </Button>
        </form>
      </header>
      <div className="px-6 py-8">{children}</div>
    </div>
  );
}
