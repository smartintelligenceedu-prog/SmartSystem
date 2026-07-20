import { Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { RegisterIntroducerForm } from "./register-introducer-form";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function RegisterIntroducerPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <div className="mb-6 flex items-center justify-between">
        <Logo />
        <LocaleSwitcher />
      </div>
      <div className="mb-8">
        <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">{await t("register_introducer.eyebrow")}</p>
        <h1 className="mt-1 text-2xl font-semibold">{await t("register_introducer.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {await t("register_introducer.subtitle")}
        </p>
      </div>
      <RegisterIntroducerForm />
    </main>
  );
}
