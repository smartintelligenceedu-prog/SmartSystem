import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface DeviceRow {
  id: string;
  serial_no: string;
  model: string | null;
  status: string;
  created_at: string;
}

export async function listDevices(): Promise<DeviceRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("devices")
    .select("id, serial_no, model, status, created_at")
    .order("created_at", { ascending: false });
  return data ?? [];
}
