import { Card, CardContent } from "@/components/ui/card";

// Shared shell for modules explicitly scoped out of Phase 3 (Customers,
// Sales Orders, Reports, Finance, Settings) — the nav item and page-level
// access gate are real, only the feature content is deferred.
export function ComingSoon({ title, description, note }: { title: string; description: string; note?: string }) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-sm font-medium">此功能开发中</p>
          {note && <p className="max-w-md text-xs text-muted-foreground">{note}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
