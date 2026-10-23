import { describe, it, expect } from "vitest";
import { rankDeliveries } from "../lib/matching";
import { localDateTime, zonedISO } from "../lib/utils";
const start = new Date("2026-10-20T14:00:00+05:00"),
  end = new Date("2026-10-20T15:00:00+05:00");
const d = {
  id: "northline",
  locationId: "a",
  windowStart: start,
  windowEnd: end,
  status: "EXPECTED",
  archived: false,
};
describe("explainable schedule matching", () => {
  it("ranks a matching entrance and window at 100", () => {
    const r = rankDeliveries(
      { locationId: "a", occurredAt: new Date("2026-10-20T14:20:00+05:00") },
      [d],
    );
    expect(r[0]).toMatchObject({ deliveryId: "northline", score: 100 });
    expect(r[0].reasons).toContain(
      "Schedule correlation only; supplier identity is unverified.",
    );
  });
  it("does not match another receiving entrance", () =>
    expect(rankDeliveries({ locationId: "b", occurredAt: start }, [d])).toEqual(
      [],
    ));
  it("requires a camera mapping", () =>
    expect(
      rankDeliveries({ locationId: null, occurredAt: start }, [d]),
    ).toEqual([]));
  it("supports a 30 minute early tolerance", () =>
    expect(
      rankDeliveries(
        { locationId: "a", occurredAt: new Date(start.getTime() - 30 * 60000) },
        [d],
      )[0].score,
    ).toBeLessThan(100));
  it("rejects activity outside the early tolerance", () =>
    expect(
      rankDeliveries(
        { locationId: "a", occurredAt: new Date(start.getTime() - 31 * 60000) },
        [d],
      ),
    ).toEqual([]));
  it("supports late activity up to two hours after the window", () =>
    expect(
      rankDeliveries(
        { locationId: "a", occurredAt: new Date(end.getTime() + 120 * 60000) },
        [d],
      ),
    ).toHaveLength(1));
  it("rejects unrelated activity after the late tolerance", () =>
    expect(
      rankDeliveries(
        { locationId: "a", occurredAt: new Date(end.getTime() + 121 * 60000) },
        [d],
      ),
    ).toEqual([]));
  it.each(["RECEIVED", "RECEIVING", "AWAITING_ACKNOWLEDGMENT", "EXCEPTION"])(
    "excludes ineligible status %s",
    (status) =>
      expect(
        rankDeliveries({ locationId: "a", occurredAt: start }, [
          { ...d, status },
        ]),
      ).toEqual([]),
  );
  it("excludes archived deliveries", () =>
    expect(
      rankDeliveries({ locationId: "a", occurredAt: start }, [
        { ...d, archived: true },
      ]),
    ).toEqual([]));
  it("keeps ambiguous matches and deterministically breaks equal scores", () => {
    const r = rankDeliveries({ locationId: "a", occurredAt: start }, [
      { ...d, id: "z" },
      { ...d, id: "a" },
    ]);
    expect(r.map((x) => x.deliveryId)).toEqual(["a", "z"]);
    expect(r.every((x) => x.score === 100)).toBe(true);
  });
  it("prefers the current window over a nearby window", () => {
    const r = rankDeliveries({ locationId: "a", occurredAt: start }, [
      {
        ...d,
        id: "early",
        windowStart: new Date(start.getTime() + 15 * 60000),
      },
      d,
    ]);
    expect(r[0].deliveryId).toBe("northline");
  });
});
describe("business time zone conversion", () => {
  it("converts Tashkent input independently of browser timezone", () =>
    expect(zonedISO("2026-10-20T14:20", "Asia/Tashkent")).toBe(
      "2026-10-20T09:20:00.000Z",
    ));
  it("round trips a non-UTC business timezone", () =>
    expect(
      localDateTime(
        zonedISO("2026-10-20T16:45", "Asia/Tashkent"),
        "Asia/Tashkent",
      ),
    ).toBe("2026-10-20T16:45"));
  it("handles negative offsets", () =>
    expect(zonedISO("2026-10-20T12:00", "America/New_York")).toBe(
      "2026-10-20T16:00:00.000Z",
    ));
});
