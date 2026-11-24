import { test, expect, type Page } from "@playwright/test";
import { AutoCorePage } from "./pom/AutoCorePage";
import { createMockFinanceSettings, createMockListResponse } from "./utils/mock-factories";

async function mockSettingsBootstrap(page: Page) {
  await page.route(AutoCorePage.apiRouteMatcher("/api/finance/settings"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createMockFinanceSettings()),
    });
  });
  await page.route(AutoCorePage.apiRouteMatcher("/api/finance/revenue-groups"), async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route(AutoCorePage.apiRouteMatcher("/api/brands"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createMockListResponse([])),
    });
  });
  await page.route(AutoCorePage.apiRouteMatcher("/api/inventory/locations/tree"), async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

test.describe("Custom fields (AUT-1043)", () => {
  test("flag OFF hides Eigene Felder in Settings and custom section in customer file", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("e2e-custom-fields-enabled", "false");
    });
    await mockSettingsBootstrap(page);
    await page.route(AutoCorePage.apiRouteMatcher("/api/customers/cust-1"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "cust-1",
          type: "PRIVATE",
          first_name: "Erika",
          last_name: "Musterfrau",
          legacy_ids: [],
          vehicles: [],
          vehicle_parties: [],
          sales_orders: [],
          workshop_orders: [],
          invoices: [],
          workshop_orders_meta: { page: 1, pageSize: 5, totalCount: 0, pageCount: 1, hasMore: false },
          invoices_meta: { page: 1, pageSize: 5, totalCount: 0, pageCount: 1, hasMore: false },
          block_level: "NONE",
        }),
      });
    });

    await page.goto("/settings");
    await expect(page.getByRole("tab", { name: "Finanzen" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Eigene Felder" })).toHaveCount(0);
    await testInfo.attach("custom-fields-flag-off-settings-de", {
      body: await page.screenshot(),
      contentType: "image/png",
    });

    await page.goto("/customers/cust-1");
    await expect(page.getByRole("heading", { name: "Erika Musterfrau" })).toBeVisible();
    await expect(page.getByTestId("custom-fields-section-customer")).toHaveCount(0);
    await testInfo.attach("custom-fields-flag-off-customer-de", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });

  test("flag ON shows Eigene Felder in Settings at desktop and 375px", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("e2e-custom-fields-enabled", "true");
    });
    await mockSettingsBootstrap(page);

    const defs = [
      {
        id: "def-1",
        entity: "CUSTOMER",
        key: "flottennummer",
        label: "Flottennummer",
        type: "TEXT",
        options: null,
        purpose: "Flottenabrechnung",
        personal_data: true,
        retention_class: "PARENT_OBJECT",
        archived: false,
        sort_order: 0,
        createdAt: "2026-11-24T00:00:00.000Z",
        updatedAt: "2026-11-24T00:00:00.000Z",
      },
    ];

    await page.route(AutoCorePage.apiRouteMatcher("/api/custom-fields/definitions"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(defs),
      });
    });

    await page.goto("/settings?tab=custom-fields");
    await expect(page.getByText(/Verantwortlicher für diese Felder/i)).toBeVisible();
    await expect(page.getByText("Flottennummer", { exact: true })).toBeVisible();

    await testInfo.attach("custom-fields-settings-de", {
      body: await page.screenshot(),
      contentType: "image/png",
    });

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByText("Flottennummer", { exact: true })).toBeVisible();
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasOverflow).toBe(false);

    await testInfo.attach("custom-fields-settings-de-375", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });

  test("customer file renders custom fields and saves inline edit", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("e2e-custom-fields-enabled", "true");
    });

    let currentCustomFields: Record<string, unknown> = { flottennummer: "FL-10" };

    await page.route(AutoCorePage.apiRouteMatcher("/api/custom-fields/definitions"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "def-1",
            entity: "CUSTOMER",
            key: "flottennummer",
            label: "Flottennummer",
            type: "TEXT",
            options: null,
            purpose: "Flottenabrechnung",
            personal_data: true,
            retention_class: "PARENT_OBJECT",
            archived: false,
            sort_order: 0,
            createdAt: "2026-11-24T00:00:00.000Z",
            updatedAt: "2026-11-24T00:00:00.000Z",
          },
        ]),
      });
    });

    await page.route(AutoCorePage.apiRouteMatcher("/api/customers/cust-1"), async (route) => {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON() as { custom_fields?: Record<string, unknown> };
        currentCustomFields = { ...currentCustomFields, ...(body.custom_fields ?? {}) };
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "cust-1",
          type: "PRIVATE",
          first_name: "Erika",
          last_name: "Musterfrau",
          legacy_ids: [],
          vehicles: [],
          vehicle_parties: [],
          sales_orders: [],
          workshop_orders: [],
          invoices: [],
          workshop_orders_meta: { page: 1, pageSize: 5, totalCount: 0, pageCount: 1, hasMore: false },
          invoices_meta: { page: 1, pageSize: 5, totalCount: 0, pageCount: 1, hasMore: false },
          block_level: "NONE",
          custom_fields: currentCustomFields,
        }),
      });
    });

    await page.goto("/customers/cust-1");
    await expect(page.getByTestId("custom-fields-section-customer")).toBeVisible();
    await page.getByRole("button", { name: "FL-10" }).click();
    const input = page.getByRole("textbox", { name: "Flottennummer" });
    await input.fill("FL-42");
    await input.press("Enter");

    await expect(page.getByText("FL-42")).toBeVisible();
    await testInfo.attach("custom-fields-customer-inline-edit-de", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });

  test("vehicle file renders vehicle custom fields section", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("e2e-custom-fields-enabled", "true");
    });

    await page.route(AutoCorePage.apiRouteMatcher("/api/custom-fields/definitions"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "def-v1",
            entity: "VEHICLE",
            key: "stellplatz",
            label: "Stellplatz",
            type: "TEXT",
            options: null,
            purpose: "Werkstattsteuerung",
            personal_data: true,
            retention_class: "PARENT_OBJECT",
            archived: false,
            sort_order: 0,
            createdAt: "2026-11-24T00:00:00.000Z",
            updatedAt: "2026-11-24T00:00:00.000Z",
          },
        ]),
      });
    });

    await page.route(AutoCorePage.apiRouteMatcher("/api/vehicles/veh-1"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "veh-1",
          make: "VW",
          model: "Golf",
          year: 2023,
          plate: "W-1043CF",
          legacy_ids: [],
          parties: [],
          open_due_dates: [],
          custom_fields: { stellplatz: "B4" },
        }),
      });
    });

    await page.goto("/vehicles/veh-1");
    const section = page.getByTestId("custom-fields-section-vehicle");
    await expect(section).toBeVisible();
    await expect(page.getByText("B4")).toBeVisible();
    await section.scrollIntoViewIfNeeded();
    await testInfo.attach("custom-fields-vehicle-de", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
});
