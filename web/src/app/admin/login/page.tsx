import { LoginForm } from "./login-form";
import { Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { t, type TranslationKey } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const ERROR_KEY: Record<string, TranslationKey> = {
  not_authorized: "login.error.not_authorized",
  incomplete_profile: "login.error.incomplete_profile",
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <div className="mb-6 flex items-center justify-between">
        <Logo />
        <LocaleSwitcher />
      </div>
      <h1 className="text-xl font-semibold">{await t("login.title")}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">{await t("login.subtitle")}</p>
      {error && (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {await t(ERROR_KEY[error] ?? "login.error.generic")}
        </p>
      )}
      <LoginForm next={next ?? "/admin"} />
    </main>
  );
}
