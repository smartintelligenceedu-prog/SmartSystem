"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/i18n-client";
import { updateCampaignInstitution, type UpdateCampaignInstitutionState } from "./actions";
import { submitWithoutReset } from "@/lib/submit-without-reset";
import type { InstitutionOption } from "../finance/institutional/data";
import { InstitutionPickerFields } from "./institution-picker-fields";

const initialState: UpdateCampaignInstitutionState = { status: "idle" };

// Lets back office attach/change a campaign's institution AFTER it's already
// been created — a campaign built with the institution section left on
// "none" (the default) otherwise has no way to be linked to a reusable
// institution record short of deleting and recreating it.
export function EditCampaignInstitutionForm({
  campaignId,
  currentInstitutionPartyId,
  institutions,
  onDone,
}: {
  campaignId: string;
  currentInstitutionPartyId: string | null;
  institutions: InstitutionOption[];
  onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(updateCampaignInstitution, initialState);
  const [mode, setMode] = useState<"none" | "existing" | "new">(currentInstitutionPartyId ? "existing" : "none");
  const [institutionPartyId, setInstitutionPartyId] = useState<string | null>(currentInstitutionPartyId);

  useEffect(() => {
    if (state.status === "success") onDone();
    // onDone is a fresh closure from the parent each render — only re-run
    // when the action's own result actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-3 rounded-md border bg-accent/20 p-4">
      <input type="hidden" name="campaign_id" value={campaignId} />
      <InstitutionPickerFields
        institutions={institutions}
        mode={mode}
        setMode={setMode}
        institutionPartyId={institutionPartyId}
        setInstitutionPartyId={setInstitutionPartyId}
        isPending={isPending}
      />
      {state.status === "error" && (
        <p className="text-sm text-destructive" role="alert">
          {state.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending || (mode === "existing" && !institutionPartyId)}>
          {ct("pic_campaigns.form.institution_save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={isPending}>
          {ct("pic_campaigns.form.institution_cancel")}
        </Button>
      </div>
    </form>
  );
}
