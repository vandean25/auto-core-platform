import { test, expect, type Page } from "@playwright/test";
import { AutoCorePage } from "./pom/AutoCorePage";
import { expectNoPageScroll } from "./utils/phone-layout";

const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

const SITE_ID = "site-1";
const CUSTOMER_ID = "51500000-0000-4000-8000-000000000021";
const VEHICLE_ID = "51500000-0000-4000-8000-000000000031";
const BAY_ID = "51500000-0000-4000-8000-000000000041";
const COMMAND_ID = "51500000-0000-4000-8000-0000000000aa";
const PROPOSAL_ID = "prop-51500000-0000-4000-8000-0000000000aa";

const SITES = [
  {
    id: SITE_ID,
    name: "Pilot Wien",
    code: "WIE",
    is_active: true,
  },
];

const CUSTOMER = {
  id: CUSTOMER_ID,
  first_name: "Alex",
  last_name: "Huber",
  company_name: null,
  type: "PRIVATE",
};

const VEHICLE = {
  id: VEHICLE_ID,
  make: "Volkswagen",
  model: "Golf",
  year: 2019,
  plate: "W-SYN 515",
  vin: "WVWZZZ3CZWE000515",
};

const BAY = {
  id: BAY_ID,
  name: "Bühne 1",
  site_id: SITE_ID,
  is_active: true,
};

const CLARIFICATION_RESPONSE = {
  contract_version: "workshop-command/v1",
  status: "clarification",
  command_id: COMMAND_ID,
  code: "CUSTOMER_AMBIGUOUS",
  prompt: "Mehrere Kunden passen. Bitte einen auswählen.",
  choices: [
    {
      choice_id: `customer:${CUSTOMER_ID}`,
      slot: "customer_id",
      value: CUSTOMER_ID,
      label: "Alex Huber — Golf — W-SYN 515",
    },
    {
      choice_id: "customer:other",
      slot: "customer_id",
      value: "51500000-0000-4000-8000-000000000022",
      label: "Bea Huber — Golf — W-SYN 516",
    },
  ],
  recognized: {
    customer_token: "Huber",
    vehicle_token: "Golf",
  },
  proposal: null,
  has_more: true,
};

const READY_INTENT_RESPONSE = {
  contract_version: "workshop-command/v1",
  status: "ready",
  command_id: COMMAND_ID,
  customer_id: CUSTOMER_ID,
  vehicle_id: VEHICLE_ID,
  site_id: SITE_ID,
  schedule: {
    local_date: "2026-10-16",
    local_start: "08:00",
    local_end: "10:30",
    duration_minutes: 150,
    duration_source: "preset_sum",
  },
  bay_id: BAY_ID,
  loaner: {
    requested: true,
    loaner_vehicle_id: "loaner-vehicle-1",
  },
  position_plan: {
    lines: [
      {
        description: "Großes Service",
        quantity: 1,
        unit: "Stk",
        net_cents: 25000,
        preset_key: "service_large",
        kind: "LABOR",
      },
    ],
  },
  proposal: null,
};

const PROPOSAL_RESPONSE = {
  contract_version: "workshop-command/v1",
  status: "needs_approval",
  command_id: COMMAND_ID,
  pending_action_id: PROPOSAL_ID,
  trace_id: "trace-1",
  action_type: "workshop.booking_package",
  tier: "PROPOSE",
  provisional: true,
  applied: false,
  would_change: [
    {
      entity: "WorkshopOrder",
      op: "create",
      provisional: true,
      id: null,
      status: "SCHEDULED",
    },
  ],
  intent: READY_INTENT_RESPONSE,
};

const APPLIED_RESPONSE = {
  id: PROPOSAL_ID,
  status: "EXECUTED",
};

async function setupMocks(page: Page) {
  await page.route(AutoCorePage.apiRouteMatcher("/api/me/sites"), (route) =>
    route.fulfill(json(SITES)),
  );
  await page.route(
    AutoCorePage.apiRouteMatcher(`/api/customers/${CUSTOMER_ID}`),
    (route) => route.fulfill(json(CUSTOMER)),
  );
  await page.route(
    AutoCorePage.apiRouteMatcher(`/api/vehicles/${VEHICLE_ID}`),
    (route) => route.fulfill(json(VEHICLE)),
  );
  await page.route(
    AutoCorePage.apiRouteMatcher(`/api/bays/${BAY_ID}`),
    (route) => route.fulfill(json(BAY)),
  );
  await page.route(AutoCorePage.apiRouteMatcher("/api/search"), (route) =>
    route.fulfill(json({ groups: [] })),
  );

  let interpretCount = 0;
  await page.route(
    AutoCorePage.apiRouteMatcher("/api/workshop/commands/interpret"),
    (route) => {
      interpretCount += 1;
      if (interpretCount === 1) {
        return route.fulfill(json(CLARIFICATION_RESPONSE));
      }
      return route.fulfill(json(READY_INTENT_RESPONSE));
    },
  );

  await page.route(
    AutoCorePage.apiRouteMatcher("/api/workshop/commands/propose"),
    (route) => route.fulfill({ status: 201, ...json(PROPOSAL_RESPONSE) }),
  );

  await page.route(
    new RegExp(`/api/agent-proposals/${PROPOSAL_ID}/apply`),
    (route) => route.fulfill(json(APPLIED_RESPONSE)),
  );
}

test.describe("Cmd+K Command Mode at 375px mobile viewport (AUT-542)", () => {
  test("input -> clarification -> preview -> applied flows with no overflow and screenshots", async ({
    page,
  }, testInfo) => {
    // 375px phone viewport (standard mobile benchmark)
    await page.setViewportSize({ width: 375, height: 812 });
    await setupMocks(page);

    const autoCore = new AutoCorePage(page, "Dashboard");
    await autoCore.navigate("/dashboard");

    // 1. Open Cmd+K palette
    await page.keyboard.press("ControlOrMeta+k");
    const commandEntry = page.getByRole("option", { name: /Werkstatt-Befehl/ });
    await expect(commandEntry).toBeVisible();

    // Enter Command Mode
    await commandEntry.click();
    const textArea = page.locator("#workshop-command-text");
    await expect(textArea).toBeVisible();

    // AUT-840: Back button and dialog close button must not overlap at 375px
    const backBtn = page.getByRole("button", { name: "Zurück zur Suche" });
    const closeBtn = page.getByRole("button", { name: "Schließen" });
    await expect(backBtn).toBeVisible();
    await expect(closeBtn).toBeVisible();
    const backBox = await backBtn.boundingBox();
    const closeBox = await closeBtn.boundingBox();
    expect(backBox).not.toBeNull();
    expect(closeBox).not.toBeNull();
    if (backBox && closeBox) {
      const horizontalOverlap =
        backBox.x < closeBox.x + closeBox.width &&
        backBox.x + backBox.width > closeBox.x;
      const verticalOverlap =
        backBox.y < closeBox.y + closeBox.height &&
        backBox.y + backBox.height > closeBox.y;
      expect(
        horizontalOverlap && verticalOverlap,
        "Back button and close button must not overlap at 375px",
      ).toBe(false);
    }
    await page.screenshot({ path: "../../docs/internal/assets/aut-840-command-header-375.png" });

    // --- Phase 1: Input ---
    await expectNoPageScroll(page);
    const screenshotInput = await page.screenshot({ fullPage: true, path: testInfo.outputPath("aut-542-command-mode-01-input-375.png") });
    await testInfo.attach("01-command-mode-input-375px.png", {
      body: screenshotInput,
      contentType: "image/png",
    });

    // --- Phase 2: Clarification ---
    await textArea.fill("Huber Golf morgen 8 Uhr großes Service");
    const reviewBtn = page.getByRole("button", { name: "Prüfen" });
    await expect(reviewBtn).toBeEnabled();
    await reviewBtn.click();

    // Clarification question displayed
    await expect(
      page.getByText("Mehrere Kunden passen. Bitte einen auswählen."),
    ).toBeVisible();
    await expect(
      page.getByText("Weitere Treffer vorhanden. Bitte Eingabe präzisieren."),
    ).toBeVisible();
    await expectNoPageScroll(page);
    const screenshotClarify = await page.screenshot({ fullPage: true, path: testInfo.outputPath("aut-542-command-mode-02-clarification-375.png") });
    await testInfo.attach("02-command-mode-clarification-375px.png", {
      body: screenshotClarify,
      contentType: "image/png",
    });

    // --- Phase 3: Preview ---
    const choiceBtn = page.getByRole("button", {
      name: /Alex Huber — Golf — W-SYN 515/,
    });
    await expect(choiceBtn).toBeVisible();
    await choiceBtn.click();

    // Preview rendered
    await expect(page.getByRole("heading", { name: "Vorschau" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Vorschlag übernehmen" }),
    ).toBeVisible();
    await expectNoPageScroll(page);
    const screenshotPreview = await page.screenshot({ fullPage: true, path: testInfo.outputPath("aut-542-command-mode-03-preview-375.png") });
    await testInfo.attach("03-command-mode-preview-375px.png", {
      body: screenshotPreview,
      contentType: "image/png",
    });

    // --- Phase 4: Applied ---
    await page.getByRole("button", { name: "Vorschlag übernehmen" }).click();

    // In Pending state
    const applyNowBtn = page.getByRole("button", { name: "Jetzt anwenden" });
    await expect(applyNowBtn).toBeVisible();
    await applyNowBtn.click();

    // Applied state
    await expect(
      page.getByRole("heading", { name: "Angewendet" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Werkstattaufträge öffnen" }),
    ).toBeVisible();
    await expectNoPageScroll(page);
    const screenshotApplied = await page.screenshot({ fullPage: true, path: testInfo.outputPath("aut-542-command-mode-04-applied-375.png") });
    await testInfo.attach("04-command-mode-applied-375px.png", {
      body: screenshotApplied,
      contentType: "image/png",
    });
  });
});
