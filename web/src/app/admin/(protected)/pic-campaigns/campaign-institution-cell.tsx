"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/i18n-client";
import { EditCampaignInstitutionForm } from "./edit-campaign-institution-form";
import type { InstitutionOption } from "../finance/institutional/data";

export function CampaignInstitutionCell({
  campaignId,
  institutionName,
  institutionPartyId,
  institutions,
}: {
  campaignId: string;
  institutionName: string | null;
  institutionPartyId: string | null;
  institutions: InstitutionOption[];
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="py-2">
        <EditCampaignInstitutionForm
          campaignId={campaignId}
          currentInstitutionPartyId={institutionPartyId}
          institutions={institutions}
          onDone={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm">{institutionName ?? <span className="text-muted-foreground">{ct("pic_campaigns.form.institution_mode_none")}</span>}</span>
      <button type="button" onClick={() => setEditing(true)} className="text-xs text-muted-foreground hover:underline">
        {ct("pic_campaigns.form.institution_edit")}
      </button>
    </div>
  );
}
