import { expect, test } from "@playwright/test";
import crypto from "node:crypto";

function createSessionToken(params: {
  userId: string;
  tenantId: string;
  role: "ADMIN" | "USER";
}): string {
  const payload = {
    uid: params.userId,
    tid: params.tenantId,
    role: params.role,
    exp: Date.now() + 24 * 60 * 60 * 1000,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = crypto
    .createHmac(
      "sha256",
      process.env.APP_SESSION_SECRET ?? "local-app-session-secret",
    )
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

test.describe("placement flow @smoke", () => {
  test.beforeEach(async ({ context }) => {
    const appSession = createSessionToken({
      userId: "smoke-admin",
      tenantId: "default",
      role: "ADMIN",
    });

    await context.addCookies([
      {
        name: "appSession",
        value: appSession,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
      },
      {
        name: "tenantId",
        value: "default",
        domain: "127.0.0.1",
        path: "/",
      },
    ]);
  });

  test("board supports core interactions", async ({ page }) => {
    await page.route("**/api/applications", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: [
            {
              id: "app-1",
              opportunityId: "opp-1",
              currentStage: "NEW",
              placedAt: null,
              agreedHourlyRate: null,
              agreedRateLockedAt: null,
              placementBillingModel: null,
              placementFeePercent: null,
              annualCtc: null,
              contractValue: null,
              signedContractFileName: null,
              signedContractMimeType: null,
              signedContractUploadedAt: null,
              job: {
                id: "job-1",
                title: "Data Engineer",
                rawText: "",
                opportunityEmail: null,
                opportunityUrl: null,
                company: { id: "co-1", name: "Acme Corp" },
              },
              candidate: {
                id: "cand-1",
                fullName: "Alex Johnson",
                email: null,
                phone: null,
                rawCV: "",
              },
              notes: [],
              emails: [{ id: "email-1" }],
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      });
    });

    await page.route("**/api/applications/app-1", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            id: "app-1",
            opportunityId: "opp-1",
            currentStage: "NEW",
            placedAt: null,
            agreedHourlyRate: null,
            agreedRateLockedAt: null,
            placementBillingModel: null,
            placementFeePercent: null,
            annualCtc: null,
            contractValue: null,
            signedContractFileName: null,
            signedContractMimeType: null,
            signedContractUploadedAt: null,
            job: {
              id: "job-1",
              title: "Data Engineer",
              rawText: "",
              opportunityEmail: null,
              opportunityUrl: null,
              company: { id: "co-1", name: "Acme Corp" },
            },
            candidate: {
              id: "cand-1",
              fullName: "Alex Johnson",
              email: null,
              phone: null,
              rawCV: "",
            },
            notes: [],
            emails: [
              {
                id: "email-1",
                subject: "Draft",
                createdAt: new Date().toISOString(),
              },
            ],
            history: [],
            updatedAt: new Date().toISOString(),
          },
        }),
      });
    });

    await page.route("**/api/email/generate", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { id: "email-1" } }),
      });
    });

    await page.route("**/api/email/draft", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { status: "draft_created" } }),
      });
    });

    await page.route("**/api/applications/app-1/stage", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: {} }),
      });
    });

    await page.goto("/applications");
    await expect(
      page.getByRole("heading", { name: "Applications", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: /Edit Alex Johnson for Data Engineer/i,
      })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: "Generate email" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Generate email" }).click();
    await page.getByRole("button", { name: "Create draft" }).click();
  });

  test("jobs actions open preview and route to match review", async ({
    page,
  }) => {
    await page.route("**/api/jobs", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: [
            {
              id: "job-123",
              title: "Senior Platform Engineer",
              rawText: "Full job description text",
              opportunityUrl: "https://www.linkedin.com/jobs/view/123",
              createdAt: new Date().toISOString(),
              company: { name: "Acme Consulting" },
            },
          ],
        }),
      });
    });

    await page.route(
      "**/api/deletion-requests?resourceType=job",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, data: [] }),
        });
      },
    );

    await page.goto("/jobs");
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByText("Job preview")).toBeVisible();
    await expect(page.getByText("Company: Acme Consulting")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText("Job preview")).toBeHidden();

    await page.getByRole("link", { name: "Review matches" }).click();
    await expect(page).toHaveURL(/\/match-review\?jobId=job-123/);
  });

  test("linkedin view full post opens preview modal", async ({ page }) => {
    await page.route("**/api/jobs", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: [
            {
              id: "li-1",
              title: "LinkedIn opportunity",
              rawText: "This is the full LinkedIn post content with details.",
              opportunityUrl: "https://www.linkedin.com/posts/example",
              createdAt: new Date().toISOString(),
              company: { name: "Globex Financial" },
            },
          ],
        }),
      });
    });

    await page.goto("/ingest/linkedin-feed");
    await page.getByRole("button", { name: "View full post" }).click();
    await expect(page.getByText("Opportunity preview")).toBeVisible();
    await expect(page.getByText("Source:")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText("Opportunity preview")).toBeHidden();
  });

  test("clients and vacancies create actions persist and show feedback", async ({
    page,
  }) => {
    let accountCreated = false;
    let vacancyCreated = false;

    await page.route("**/api/client-accounts", async (route) => {
      if (route.request().method() === "POST") {
        accountCreated = true;
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, data: { id: "account-2" } }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: [
            {
              id: "account-1",
              name: "Acme Consulting",
              domain: "acme.example",
              contractTerms: null,
              billingNotes: null,
              isActive: true,
              _count: { contacts: 0, vacancies: 0 },
            },
            ...(accountCreated
              ? [
                  {
                    id: "account-2",
                    name: "Northwind Engineering",
                    domain: null,
                    contractTerms: null,
                    billingNotes: null,
                    isActive: true,
                    _count: { contacts: 0, vacancies: 0 },
                  },
                ]
              : []),
          ],
        }),
      });
    });

    await page.route("**/api/client-contacts", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: [] }),
      });
    });

    await page.route("**/api/vacancies", async (route) => {
      if (route.request().method() === "POST") {
        vacancyCreated = true;
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, data: { id: "vac-2" } }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: [
            {
              id: "vac-1",
              title: "Cloud Engineer",
              description: "Initial role",
              stage: "OPEN",
              slaDate: null,
              offerStatus: null,
              reasonCode: null,
              clientAccount: { id: "account-1", name: "Acme Consulting" },
              hiringManager: null,
            },
            ...(vacancyCreated
              ? [
                  {
                    id: "vac-2",
                    title: "Platform Engineer",
                    description: "New role description",
                    stage: "OPEN",
                    slaDate: null,
                    offerStatus: null,
                    reasonCode: null,
                    clientAccount: {
                      id: "account-1",
                      name: "Acme Consulting",
                    },
                    hiringManager: null,
                  },
                ]
              : []),
          ],
        }),
      });
    });

    await page.route("**/api/vacancies/*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: {} }),
      });
    });

    await page.route(
      "**/api/deletion-requests?resourceType=vacancy",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, data: [] }),
        });
      },
    );

    await page.goto("/clients");
    await page
      .getByPlaceholder("Client account name")
      .fill("Northwind Engineering");
    await page.getByRole("button", { name: "Create client account" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Client account created." }),
    ).toBeVisible();

    await page.goto("/vacancies");
    await page.getByPlaceholder("Vacancy title").fill("Platform Engineer");
    await page
      .getByPlaceholder("Vacancy description")
      .fill("New role description with full details");
    await page.getByRole("button", { name: "Create vacancy" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Vacancy created." }),
    ).toBeVisible();
  });
});
