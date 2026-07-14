import { redirect } from "next/navigation";
import { getPortalUserContext } from "@/lib/auth/context";
import { isBackOfficeRole } from "@/lib/auth/roles";
import { listDevices } from "./data";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { t } from "@/lib/i18n";
import { CreateDeviceForm } from "./create-device-form";

export const dynamic = "force-dynamic";

const STATUS_LABEL_KEY: Record<string, Parameters<typeof t>[0]> = {
  active: "devices.status.active",
  maintenance: "devices.status.maintenance",
  lost: "devices.status.lost",
  retired: "devices.status.retired",
};

export default async function DevicesPage() {
  const context = await getPortalUserContext();
  if (!context) redirect("/admin/login");
  if (!isBackOfficeRole(context)) redirect("/admin");

  const devices = await listDevices();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t("devices.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("devices.subtitle")}</p>
      </div>

      <CreateDeviceForm />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("devices.column.serial_no")}</TableHead>
            <TableHead>{t("devices.column.model")}</TableHead>
            <TableHead>{t("devices.column.status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {devices.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                {t("devices.empty")}
              </TableCell>
            </TableRow>
          )}
          {devices.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="font-mono">{d.serial_no}</TableCell>
              <TableCell>{d.model ?? "—"}</TableCell>
              <TableCell>
                <Badge variant="secondary">{t(STATUS_LABEL_KEY[d.status] ?? "devices.status.active")}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
