export interface Matchable {
  id: string;
  locationId: string;
  windowStart: Date;
  windowEnd: Date;
  status: string;
  archived: boolean;
}
export function rankDeliveries(
  event: { locationId: string | null; occurredAt: Date },
  deliveries: Matchable[],
) {
  if (!event.locationId) return [];
  return deliveries
    .flatMap((d) => {
      if (
        d.archived ||
        !["EXPECTED", "DELAYED", "POSSIBLE_ARRIVAL"].includes(d.status) ||
        d.locationId !== event.locationId
      )
        return [];
      const t = event.occurredAt.getTime(),
        start = d.windowStart.getTime(),
        end = d.windowEnd.getTime();
      if (t < start - 30 * 60000 || t > end + 120 * 60000) return [];
      const inWindow = t >= start && t <= end;
      const distance = t < start ? start - t : t > end ? t - end : 0;
      const score = inWindow
        ? 100
        : Math.max(1, 70 - Math.floor(distance / 60000));
      const reasons = [
        "Receiving entrance matches.",
        inWindow
          ? "Activity falls within the expected time window."
          : t < start
            ? `Activity is ${Math.round(distance / 60000)} min before the window.`
            : `Activity is ${Math.round(distance / 60000)} min after the window.`,
        "Schedule correlation only; supplier identity is unverified.",
      ];
      return [{ deliveryId: d.id, score, reasons }];
    })
    .sort(
      (a, b) => b.score - a.score || a.deliveryId.localeCompare(b.deliveryId),
    );
}
