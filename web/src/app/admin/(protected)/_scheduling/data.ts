import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface DeviceOption {
  id: string;
  label: string;
}

export interface CenterOption {
  id: string;
  name: string;
}

function deviceLabel(serial_no: string, model: string | null) {
  return model ? `${serial_no}（${model}）` : serial_no;
}

export async function listActiveDevices(): Promise<DeviceOption[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("devices").select("id, serial_no, model").eq("status", "active").order("serial_no");
  return (data ?? []).map((d) => ({ id: d.id, label: deviceLabel(d.serial_no, d.model) }));
}

export async function listActiveCenters(): Promise<CenterOption[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("detection_centers").select("id, name").eq("status", "active").order("name");
  return (data ?? []).map((c) => ({ id: c.id, name: c.name }));
}

export interface PendingAppointment {
  appointment_id: string;
  device_label: string;
  center_name: string;
  scheduled_at: string;
  duration_minutes: number;
}

// Stage 1 (schedule/actions.ts) creates these as 'pending_assessment'; this
// lists a single subject's outstanding ones so the report page can offer
// "enter this appointment's result" instead of ever letting scores be typed
// without a real booking behind them.
async function listPendingAppointments(filter: { child_id: string } | { customer_id_self: string }): Promise<PendingAppointment[]> {
  const admin = createAdminClient();
  let query = admin
    .from("detection_appointments")
    .select("id, scheduled_at, duration_minutes, device_id, center_id")
    .eq("status", "pending_assessment");
  query = "child_id" in filter ? query.eq("child_id", filter.child_id) : query.eq("customer_id", filter.customer_id_self).is("child_id", null);
  const { data: appointments } = await query.order("scheduled_at", { ascending: true });
  if (!appointments || appointments.length === 0) return [];

  const deviceIds = [...new Set(appointments.map((a) => a.device_id))];
  const centerIds = [...new Set(appointments.map((a) => a.center_id).filter((id): id is string => !!id))];
  const [{ data: devices }, { data: centers }] = await Promise.all([
    admin.from("devices").select("id, serial_no, model").in("id", deviceIds),
    centerIds.length > 0 ? admin.from("detection_centers").select("id, name").in("id", centerIds) : Promise.resolve({ data: [] }),
  ]);
  const deviceById = new Map((devices ?? []).map((d) => [d.id, d]));
  const centerById = new Map((centers ?? []).map((c) => [c.id, c.name]));

  return appointments.map((a) => {
    const device = deviceById.get(a.device_id);
    return {
      appointment_id: a.id,
      device_label: device ? deviceLabel(device.serial_no, device.model) : "—",
      center_name: (a.center_id && centerById.get(a.center_id)) ?? "—",
      scheduled_at: a.scheduled_at,
      duration_minutes: a.duration_minutes,
    };
  });
}

export function listPendingAppointmentsForChild(childId: string): Promise<PendingAppointment[]> {
  return listPendingAppointments({ child_id: childId });
}

// Migration 028 — same as listPendingAppointmentsForChild but for a customer
// assessed directly (child_id is null on these appointments).
export function listPendingAppointmentsForCustomerSelf(customerId: string): Promise<PendingAppointment[]> {
  return listPendingAppointments({ customer_id_self: customerId });
}

export interface CustomerChildOption {
  customer_id: string;
  customer_name: string;
  children: { id: string; name: string }[];
}

// Powers the inline booking form on the shared /admin/schedule timeline
// (2026-07-14 request: let staff book directly from that page instead of
// only from a customer's own detail page). Scoped the same way the
// customers list already is — an analyst only sees their own customers,
// back office sees everyone — so this doesn't leak any customer identity
// beyond what that analyst could already see on their Customer list.
export async function listCustomersWithChildrenForBooking(isBackOffice: boolean, analystId: string | null): Promise<CustomerChildOption[]> {
  const admin = createAdminClient();

  let query = admin.from("customers").select("id, party_id, owner_analyst_id").eq("status", "active");
  if (!isBackOffice && analystId) query = query.eq("owner_analyst_id", analystId);
  const { data: customers } = await query;
  if (!customers || customers.length === 0) return [];

  const partyIds = customers.map((c) => c.party_id);
  const customerIds = customers.map((c) => c.id);
  const [{ data: individuals }, { data: children }] = await Promise.all([
    partyIds.length > 0 ? admin.from("individuals").select("party_id, full_name").in("party_id", partyIds) : Promise.resolve({ data: [] }),
    admin.from("customer_children").select("id, customer_id, full_name").in("customer_id", customerIds),
  ]);
  const nameByParty = new Map((individuals ?? []).map((i) => [i.party_id, i.full_name]));

  const childrenByCustomer = new Map<string, { id: string; name: string }[]>();
  for (const ch of children ?? []) {
    const arr = childrenByCustomer.get(ch.customer_id) ?? [];
    arr.push({ id: ch.id, name: ch.full_name });
    childrenByCustomer.set(ch.customer_id, arr);
  }

  return customers
    .map((c) => ({
      customer_id: c.id,
      customer_name: nameByParty.get(c.party_id) ?? "—",
      children: childrenByCustomer.get(c.id) ?? [],
    }))
    .sort((a, b) => a.customer_name.localeCompare(b.customer_name));
}

export interface DeviceScheduleSlot {
  appointment_id: string;
  start_at: string;
  end_at: string;
  analyst_name: string;
}

export interface DeviceScheduleGroup {
  device_id: string;
  device_label: string;
  slots: DeviceScheduleSlot[];
}

// Shows WHO (analyst name) has a device booked and WHEN — deliberately never
// the customer/child name. This is a shared coordination view across every
// analyst's bookings (so no one double-books a device), but the CRM's
// "顾客资料归属" rule is still respected: one analyst can see that another
// analyst is busy with the machine, never which family that session is for.
export async function listDeviceScheduleForDate(dateStr: string): Promise<DeviceScheduleGroup[]> {
  const admin = createAdminClient();

  const dayStart = new Date(`${dateStr}T00:00:00+08:00`);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const [{ data: devices }, { data: appointments }] = await Promise.all([
    admin.from("devices").select("id, serial_no, model").eq("status", "active").order("serial_no"),
    admin
      .from("detection_appointments")
      .select("id, device_id, analyst_id, scheduled_at, duration_minutes, status")
      .gte("scheduled_at", dayStart.toISOString())
      .lt("scheduled_at", dayEnd.toISOString())
      .not("status", "in", "(cancelled,no_show)"),
  ]);

  const analystIds = [...new Set((appointments ?? []).map((a) => a.analyst_id))];
  const { data: analysts } = analystIds.length > 0 ? await admin.from("analysts").select("id, party_id").in("id", analystIds) : { data: [] };
  const partyByAnalyst = new Map((analysts ?? []).map((a) => [a.id, a.party_id]));
  const partyIds = [...partyByAnalyst.values()];
  const { data: identities } =
    partyIds.length > 0 ? await admin.from("individuals").select("party_id, full_name").in("party_id", partyIds) : { data: [] };
  const nameByParty = new Map((identities ?? []).map((i) => [i.party_id, i.full_name]));

  return (devices ?? []).map((d) => {
    const slots = (appointments ?? [])
      .filter((a) => a.device_id === d.id)
      .map((a) => {
        const start = new Date(a.scheduled_at);
        const end = new Date(start.getTime() + a.duration_minutes * 60000);
        const party = partyByAnalyst.get(a.analyst_id);
        return {
          appointment_id: a.id as string,
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          analyst_name: (party && nameByParty.get(party)) ?? "—",
        };
      })
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
    return { device_id: d.id, device_label: deviceLabel(d.serial_no, d.model), slots };
  });
}
