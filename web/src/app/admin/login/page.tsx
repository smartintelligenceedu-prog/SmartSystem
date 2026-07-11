import { LoginForm } from "./login-form";
import { Logo } from "@/components/logo";

export const dynamic = "force-dynamic";

const ERROR_MESSAGE: Record<string, string> = {
  not_authorized: "此帐号没有后台权限，请联系管理员",
  incomplete_profile: "帐号资料不完整，请联系管理员",
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <Logo className="mb-6" />
      <h1 className="text-xl font-semibold">后台登入</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">仅限公司后台人员使用</p>
      {error && (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {ERROR_MESSAGE[error] ?? "登入时发生错误"}
        </p>
      )}
      <LoginForm next={next ?? "/admin"} />
    </main>
  );
}
