import { test, expect, type Page } from "@playwright/test";
import { AutoCorePage } from "./pom/AutoCorePage";
import { createMockFinanceSettings, createMockListResponse } from "./utils/mock-factories";

/**
 * Blueprint: tenant API keys in Settings (AUT-411, ADR-0026).
 *
 * OWNER and ADMIN create, list and revoke keys. The full key is shown once, in the dialog that follows
 * creation. Other roles do not see the tab. The API keeps its own 403 rules (see the backend e2e spec).
 */

type MockKey = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  createdAt: string;
  createdByEmail: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

const NEW_KEY_ID = "5b1c2d3e-4f50-4a61-8b72-9c83d4e5f601";
const NEW_KEY_SECRET = "a".repeat(64);
const NEW_KEY_TOKEN = `acp_live_${NEW_KEY_ID}_${NEW_KEY_SECRET}`;

const seededKey: MockKey = {
  id: "key-warehouse-bi",
  name: "Warehouse BI",
  keyPrefix: "acp_live_3f9a2c1b",
  scopes: ["customers:read", "stock:read"],
  status: "ACTIVE",
  createdAt: "2026-10-01T08:00:00.000Z",
  createdByEmail: "owner@example.com",
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
};

function rowFor(page: Page, text: string) {
  return page.locator('[data-table-row="true"]').filter({ hasText: text }).first();
}

/** Settings loads these endpoints on mount, whichever tab is open. */
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

/** Stateful fake of the tenant API key endpoints. Keeps the calls so tests can assert on them. */
async function mockApiKeys(page: Page, initial: MockKey[]) {
  const keys = [...initial];
  const calls: { method: string; path: string }[] = [];

  await page.route(AutoCorePage.apiRouteMatcher("/api/tenant-api-keys"), async (route) => {
    const method = route.request().method();
    calls.push({ method, path: new URL(route.request().url()).pathname });

    if (method === "POST") {
      const body = route.request().postDataJSON() as { name: string; scopes: string[] };
      const created: MockKey = {
        id: NEW_KEY_ID,
        name: body.name,
        keyPrefix: `acp_live_${NEW_KEY_ID.slice(0, 8)}`,
        scopes: body.scopes,
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        createdByEmail: "owner@example.com",
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
      };
      keys.unshift(created);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ ...created, token: NEW_KEY_TOKEN }),
      });
      return;
    }

    // The list never carries the token, so reloading the table cannot reveal it again.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: keys }),
    });
  });

  await page.route(/\/api\/tenant-api-keys\/([^/]+)\/revoke$/, async (route) => {
    const path = new URL(route.request().url()).pathname;
    calls.push({ method: route.request().method(), path });
    const id = path.split("/")[3];
    const key = keys.find((candidate) => candidate.id === id);

    if (!key) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ message: "API key not found." }),
      });
      return;
    }

    key.status = "REVOKED";
    key.revokedAt = new Date().toISOString();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(key),
    });
  });

  return { calls };
}

test.describe("Blueprint: API keys settings", () => {
  test("OWNER/ADMIN creates a key, sees the token once, then revokes it", async ({ page }) => {
    await mockSettingsBootstrap(page);
    const { calls } = await mockApiKeys(page, [seededKey]);

    const corePage = new AutoCorePage(page, "Settings");
    await corePage.navigate("/settings?tab=api-keys");

    await expect(page.getByRole("heading", { name: "API keys", exact: true })).toBeVisible();
    const seededRow = rowFor(page, "Warehouse BI");
    await expect(seededRow).toBeVisible();
    await expect(seededRow).toContainText("acp_live_3f9a2c1b");
    await expect(seededRow).toContainText(/ACTIVE/i);

    // Create: the form refuses an empty name and an empty scope set.
    await page.getByRole("button", { name: "+ API key" }).click();
    const createDialog = page.getByRole("dialog", { name: "New API key" });
    await expect(createDialog).toBeVisible();
    await createDialog.getByRole("button", { name: "Create key" }).click();
    await expect(createDialog.getByRole("alert")).toHaveText("Enter a name for the key.");

    await createDialog.getByLabel("Name").fill("Dashboard feed");
    await createDialog.getByRole("button", { name: "Create key" }).click();
    await expect(createDialog.getByRole("alert")).toHaveText("Select at least one scope.");

    await createDialog.getByRole("checkbox", { name: "Customers", exact: true }).click();
    await createDialog.getByRole("checkbox", { name: "Vehicles", exact: true }).click();
    await createDialog.getByRole("button", { name: "Create key" }).click();

    // The token is shown in its own dialog, once.
    const tokenDialog = page.getByRole("dialog", { name: "Copy your new API key" });
    await expect(tokenDialog).toBeVisible();
    await expect(tokenDialog.getByLabel("API key")).toHaveValue(NEW_KEY_TOKEN);
    await tokenDialog.getByRole("button", { name: "Done" }).click();
    await expect(tokenDialog).toBeHidden();

    // The list shows the new key but never its token.
    const createdRow = rowFor(page, "Dashboard feed");
    await expect(createdRow).toBeVisible();
    await expect(createdRow).toContainText("customers:read");
    await expect(createdRow).toContainText("vehicles:read");
    await expect(page.getByText(NEW_KEY_TOKEN)).toHaveCount(0);

    const created = calls.find((call) => call.method === "POST");
    expect(created?.path).toBe("/api/tenant-api-keys");

    // Revoke: confirm first, then the row turns REVOKED and loses its Revoke action.
    await createdRow.getByRole("button", { name: "Revoke" }).click();
    const revokeDialog = page.getByRole("alertdialog", { name: "Revoke API key?" });
    await expect(revokeDialog).toBeVisible();
    await revokeDialog.getByRole("button", { name: "Revoke key" }).click();

    await expect(rowFor(page, "Dashboard feed")).toContainText(/REVOKED/i);
    await expect(rowFor(page, "Dashboard feed").getByRole("button", { name: "Revoke" })).toHaveCount(0);
    expect(calls).toContainEqual({
      method: "POST",
      path: `/api/tenant-api-keys/${NEW_KEY_ID}/revoke`,
    });
  });

  test("keeps the API keys tab away from SALES users", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("e2e-active-role", "SALES");
    });
    await mockSettingsBootstrap(page);
    await mockApiKeys(page, [seededKey]);

    const corePage = new AutoCorePage(page, "Settings");
    await corePage.navigate("/settings");

    await expect(page.getByRole("tab", { name: "Audit Logs" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "API keys" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Team" })).toHaveCount(0);
  });

  test("shows an error with Retry when the key list cannot be loaded", async ({ page }) => {
    await mockSettingsBootstrap(page);
    await page.route(AutoCorePage.apiRouteMatcher("/api/tenant-api-keys"), async (route) => {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ message: "Only tenant owners and admins can manage API keys." }),
      });
    });

    const corePage = new AutoCorePage(page, "Settings");
    await corePage.navigate("/settings?tab=api-keys");

    await expect(
      page.getByText("Only tenant owners and admins can manage API keys.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});
