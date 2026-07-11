import { LoginForm } from "./login-form";
import { Logo } from "@/components/logo";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <Logo className="mb-6" />
      <h1 className="text-xl font-semibold">后台登入</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">仅限公司后台人员使用</p>
      <LoginForm next={next ?? "/admin/registrations"} />
    </main>
  );
}
