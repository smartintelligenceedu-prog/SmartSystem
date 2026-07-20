"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateLeadStatus, adminReassignLead } from "./actions";
import { t } from "@/lib/i18n";
import type { LeadRow } from "./data";

export function LeadActionsCell({
  lead,
  isBackOffice,
  analysts,
}: {
  lead: LeadRow;
  isBackOffice: boolean;
  analysts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [reassigning, setReassigning] = useState(false);
  const [selectedAnalyst, setSelectedAnalyst] = useState(lead.assigned_analyst_id ?? "");

  function setStatus(status: "contacted" | "lost") {
    startTransition(async () => {
      const result = await updateLeadStatus(lead.id, status);
      setMessage(result.ok ? null : result.message);
      if (result.ok) router.refresh();
    });
  }

  function reassign() {
    if (!selectedAnalyst) return;
    startTransition(async () => {
      const result = await adminReassignLead(lead.id, selectedAnalyst);
      setMessage(result.ok ? null : result.message);
      if (result.ok) {
        setReassigning(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {lead.status !== "converted" && (
        <div className="flex items-center gap-2">
          {lead.status !== "contacted" && (
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setStatus("contacted")}>
              {t("leads.action.mark_contacted")}
            </Button>
          )}
          {lead.status !== "lost" && (
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setStatus("lost")}>
              {t("leads.action.mark_lost")}
            </Button>
          )}
          <Button size="sm" variant="outline" render={<Link href={`/admin/customers/new?lead_id=${lead.id}`}>{t("leads.action.convert")}</Link>} />
        </div>
      )}
      {isBackOffice && (
        <div className="flex items-center gap-2">
          {reassigning ? (
            <>
              <Select
                value={selectedAnalyst}
                items={analysts.map((a) => ({ value: a.id, label: a.name }))}
                onValueChange={(v) => setSelectedAnalyst(v ?? "")}
              >
                <SelectTrigger className="h-8 w-40">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {analysts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" disabled={isPending} onClick={reassign}>
                {t("leads.action.reassign_save")}
              </Button>
              <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setReassigning(false)}>
                {t("leads.action.reassign_cancel")}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setReassigning(true)}>
              {t("leads.action.reassign")}
            </Button>
          )}
        </div>
      )}
      {message && <p className="text-xs text-destructive">{message}</p>}
    </div>
  );
}
