import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
export const initials = (s: string) =>
  s
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
export const statusLabel = (s: string) =>
  ({
    EXPECTED: "Expected",
    POSSIBLE_ARRIVAL: "Possible arrival",
    AWAITING_ACKNOWLEDGMENT: "Awaiting acknowledgment",
    ACKNOWLEDGED: "Acknowledged",
    PENDING: "Awaiting acknowledgment",
    RECEIVING: "Receiving",
    RECEIVED: "Received",
    DELAYED: "Delayed",
    EXCEPTION: "Exception",
    ESCALATED: "Escalated",
  })[s] ?? s;
export function time(value: string, tz: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  }).format(new Date(value));
}
export function dateLabel(value: string, tz: string) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "numeric",
    timeZone: tz,
  }).format(new Date(value));
}
export function localDateTime(value: string, tz: string) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
  return parts.replace(" ", "T").slice(0, 16);
}
// Convert an HTML datetime-local value in the business timezone, independent of the browser timezone.
export function zonedISO(value: string, tz: string) {
  const base = new Date(value + "Z");
  let result = base.getTime();
  for (let i = 0; i < 3; i++) {
    const actual = localDateTime(new Date(result).toISOString(), tz);
    const offset = new Date(actual + ":00Z").getTime() - base.getTime();
    result -= offset;
  }
  return new Date(result).toISOString();
}
export function duration(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}
