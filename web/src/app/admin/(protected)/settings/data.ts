import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface CompanyInfo {
  name: string;
  ssmNumber: string;
  addressLine1: string;
  addressLine2: string;
  phone: string;
  email: string;
}

const DEFAULT_COMPANY_INFO: CompanyInfo = {
  name: "Smart Intelligence Edu",
  ssmNumber: "",
  addressLine1: "",
  addressLine2: "Kajang, Selangor, Malaysia",
  phone: "",
  email: "info@smartintelligenceedu.com",
};

export const COMPANY_INFO_SETTINGS_KEY = "company_info";

export async function getCompanyInfo(): Promise<CompanyInfo> {
  const admin = createAdminClient();
  const { data } = await admin.from("settings").select("value").eq("key", COMPANY_INFO_SETTINGS_KEY).maybeSingle();
  if (!data) return DEFAULT_COMPANY_INFO;
  return { ...DEFAULT_COMPANY_INFO, ...(data.value as Partial<CompanyInfo>) };
}
