import type { Prisma } from "@prisma/client";
import { BUSINESS_ID } from "./db";
export type Tx = Prisma.TransactionClient;
export type Initiator = { id: string; name: string };
export const systemActor = { id: "system:ring", name: "Ring integration" };
export async function audit(
  tx: Tx,
  actor: Initiator,
  action: string,
  message: string,
  source = "HUMAN",
  links: { deliveryId?: string; taskId?: string; eventId?: string } = {},
) {
  return tx.auditLog.create({
    data: {
      businessId: BUSINESS_ID,
      actorId: actor.id,
      actorName: actor.name,
      action,
      message,
      source,
      ...links,
    },
  });
}
export async function notify(
  tx: Tx,
  employeeId: string,
  message: string,
  taskId?: string,
) {
  const b = await tx.business.findUniqueOrThrow({ where: { id: BUSINESS_ID } });
  if (b.notificationsEnabled)
    await tx.notification.create({
      data: { businessId: BUSINESS_ID, employeeId, message, taskId },
    });
}
export async function notifyManagers(tx: Tx, message: string, taskId?: string) {
  for (const e of await tx.employee.findMany({
    where: { businessId: BUSINESS_ID, role: "MANAGER", archived: false },
  }))
    await notify(tx, e.id, message, taskId);
}
