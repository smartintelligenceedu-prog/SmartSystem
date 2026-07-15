import { Logo } from "@/components/logo";
import { RegisterIntroducerForm } from "./register-introducer-form";

export const dynamic = "force-dynamic";

export default function RegisterIntroducerPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <Logo className="mb-6" />
      <div className="mb-8">
        <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">TQC 引荐人申请</p>
        <h1 className="mt-1 text-2xl font-semibold">申请成为 TQC 引荐人</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          填写以下资料并提交，后台审核通过后即可开始引荐顾客并赚取佣金。
        </p>
      </div>
      <RegisterIntroducerForm />
    </main>
  );
}
