import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test.describe.configure({ mode: "serial" });
async function asManager(page: import("@playwright/test").Page) {
  await page.request.post("/api/session", { data: { employeeId: "manager" } });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Every delivery. A clear handoff." }),
  ).toBeVisible();
}
test("schedule create, search, edit, remove, and source-attributed history", async ({
  page,
}) => {
  await asManager(page);
  const reference = "E2E-" + randomUUID().slice(0, 6);
  await page.getByRole("button", { name: "New delivery", exact: true }).click();
  await page
    .getByLabel("Supplier name", { exact: true })
    .fill("Browser QA Supplier");
  await page
    .getByLabel("Order / reference number", { exact: true })
    .fill(reference);
  await page
    .getByLabel("Assigned employee", { exact: true })
    .selectOption("alex");
  await page
    .getByRole("button", { name: "Save delivery", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Deliveries", exact: true }).click();
  await page.getByLabel("Search deliveries").fill(reference);
  await expect(
    page.getByRole("button", { name: `Browser QA Supplier ${reference}` }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit Browser QA Supplier" }).click();
  await page
    .getByLabel("Supplier name", { exact: true })
    .fill("Browser QA Edited");
  await page
    .getByRole("button", { name: "Save delivery", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: `Browser QA Edited ${reference}` }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove Browser QA Edited" }).click();
  await page
    .getByRole("button", { name: "Remove delivery", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("No deliveries found")).toBeVisible();
  await page
    .getByRole("button", { name: "Activity History", exact: true })
    .click();
  await page.getByLabel("Search audit history").fill("Browser QA Edited");
  await expect(page.getByText(/Removed Browser QA Edited/)).toBeVisible();
});
test("local arrival → manager match → Alex notification → human-confirmed receipt", async ({
  page,
}) => {
  await asManager(page);
  const state = await (await page.request.get("/api/state")).json();
  const date = state.today;
  const ref = "HANDOFF-" + randomUUID().slice(0, 6);
  const created = await page.request.post("/api/deliveries", {
    data: {
      supplier: "E2E Delivery Supplies",
      reference: ref,
      windowStart: `${date}T14:00:00+05:00`,
      windowEnd: `${date}T15:00:00+05:00`,
      locationId: "entrance-a",
      employeeId: "alex",
      notes: "E2E fixture",
    },
  });
  expect(created.status()).toBe(201);
  await page
    .getByRole("button", { name: "Create test activity", exact: true })
    .click();
  await page
    .getByLabel("Test scenario", { exact: true })
    .selectOption("standard");
  await page
    .getByRole("button", { name: "Generate local test event", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Entrance activity/ }),
  ).toBeVisible();
  await page.locator(".event-row").first().click();
  const candidate = page
    .locator(".candidate-card")
    .filter({ hasText: "E2E Delivery Supplies" });
  await expect(candidate).toContainText("Receiving entrance matches.");
  await expect(
    page.getByText("Local test", { exact: true }).first(),
  ).toBeVisible();
  await candidate
    .getByRole("button", { name: "Select match & assign task" })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("Acting as employee").selectOption("alex");
  await expect(page.getByLabel("Acting as employee")).toHaveValue("alex");
  await page.getByRole("button", { name: /Notifications/ }).click();
  await expect(page.locator(".notification-panel")).toContainText(
    "E2E Delivery Supplies",
  );
  await page
    .getByRole("button", { name: "Receiving Tasks", exact: true })
    .click();
  const card = page.locator(".task-card").filter({ hasText: ref });
  await card.getByRole("button", { name: "Acknowledge", exact: true }).click();
  await expect(card).toContainText("Acknowledged");
  await card
    .getByRole("button", { name: "Start receiving", exact: true })
    .click();
  await expect(card).toContainText("Receiving");
  await card
    .getByRole("button", { name: "Confirm received", exact: true })
    .click();
  await expect(card).toContainText("Human confirmed");
  await page.reload();
  await page
    .getByRole("button", { name: "Receiving Tasks", exact: true })
    .click();
  await expect(
    page.locator(".task-card").filter({ hasText: ref }),
  ).toContainText("Received");
  await page
    .getByRole("button", { name: "Activity History", exact: true })
    .click();
  await page.getByLabel("Search audit history").fill("physical receipt");
  await expect(page.locator(".audit-timeline")).toContainText("Alex");
});
test("SSE refreshes another open dashboard after a persisted delivery change", async ({
  page,
  browser,
}) => {
  await asManager(page);
  const context = await browser.newContext();
  const other = await context.newPage();
  await asManager(other);
  await page.getByRole("button", { name: "Deliveries", exact: true }).click();
  const ref = "SSE-" + randomUUID().slice(0, 6);
  const state = await (await other.request.get("/api/state")).json();
  await other.request.post("/api/deliveries", {
    data: {
      supplier: "SSE Visible Supplier",
      reference: ref,
      windowStart: `${state.today}T18:00:00+05:00`,
      windowEnd: `${state.today}T19:00:00+05:00`,
      locationId: "entrance-b",
      employeeId: "jordan",
      notes: "",
    },
  });
  await expect(
    page.getByRole("button", { name: `SSE Visible Supplier ${ref}` }),
  ).toBeVisible({ timeout: 10000 });
  await context.close();
});
test("duplicate local requests are idempotent; forged webhook signatures are rejected", async ({
  request,
}) => {
  const state = await (await request.get("/api/state")).json();
  const input = {
    cameraId: "test-a",
    type: "motion_detected",
    scenario: "duplicate",
    occurredAt: `${state.today}T14:20:00+05:00`,
  };
  const a = await (
    await request.post("/api/test-events", { data: input })
  ).json();
  const b = await (
    await request.post("/api/test-events", { data: input })
  ).json();
  expect(a.eventId).toBe(b.eventId);
  expect(b.duplicate).toBe(true);
  const webhook = await request.post("/api/webhooks/ring", {
    headers: { "X-Signature": "sha256=" + "0".repeat(64) },
    data: {},
  });
  expect([401, 503]).toContain(webhook.status());
});
test("mobile navigation, theme, employee management, and missing Ring-token feedback", async ({
  page,
}) => {
  await asManager(page);
  await page.getByRole("button", { name: "Use dark mode" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Use light mode" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Verify & discover devices" }).click();
  await expect(page.getByRole("alert")).toContainText("RING_ACCESS_TOKEN");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Employees", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Employees", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add employee" }).click();
  await page.getByLabel("Full name", { exact: true }).fill("Browser QA Taylor");
  await page.getByRole("button", { name: "Save employee" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.locator(".employee-card").filter({ hasText: "Browser QA Taylor" }),
  ).toBeVisible();
});
