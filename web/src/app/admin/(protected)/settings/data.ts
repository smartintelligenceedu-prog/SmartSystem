import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface CompanyInfo {
  name: string;
  ssmNumber: string;
  addressLine1: string;
  addressLine2: string;
  phone: string;
  email: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  invoiceTerms: string;
  agreementUrl: string;
}

const DEFAULT_COMPANY_INFO: CompanyInfo = {
  name: "Smart Intelligence Edu",
  ssmNumber: "",
  addressLine1: "",
  addressLine2: "Kajang, Selangor, Malaysia",
  phone: "",
  email: "info@smartintelligenceedu.com",
  bankName: "",
  bankAccountName: "",
  bankAccountNumber: "",
  invoiceTerms: "",
  agreementUrl: "",
};

export const COMPANY_INFO_SETTINGS_KEY = "company_info";

export async function getCompanyInfo(): Promise<CompanyInfo> {
  const admin = createAdminClient();
  const { data } = await admin.from("settings").select("value").eq("key", COMPANY_INFO_SETTINGS_KEY).maybeSingle();
  if (!data) return DEFAULT_COMPANY_INFO;
  return { ...DEFAULT_COMPANY_INFO, ...(data.value as Partial<CompanyInfo>) };
}

export interface ReportCostSettings {
  standardCost: number;
  upgradeCost: number;
}

const DEFAULT_REPORT_COST_SETTINGS: ReportCostSettings = {
  standardCost: 25,
  upgradeCost: 125,
};

export const REPORT_COST_SETTINGS_KEY = "report_cost";

// Read by calculate_report_override_commission() (migration 060) at the
// moment each report is delivered, so this is the live rate used for every
// new report cost posting — not just a display value.
export async function getReportCostSettings(): Promise<ReportCostSettings> {
  const admin = createAdminClient();
  const { data } = await admin.from("settings").select("value").eq("key", REPORT_COST_SETTINGS_KEY).maybeSingle();
  if (!data) return DEFAULT_REPORT_COST_SETTINGS;
  return { ...DEFAULT_REPORT_COST_SETTINGS, ...(data.value as Partial<ReportCostSettings>) };
}
