import { createHash, randomBytes } from "node:crypto";

import { faker } from "@faker-js/faker";
import { expect, type Page, test } from "@playwright/test";

import { createTestUser, deleteTestUser } from "./helpers/test-user";

const TEST_PASSWORD = "myreallystrongpassword";
// Any same-origin page works as the OAuth callback target — we only need the
// browser to land somewhere that preserves the ?code=&state= query params.
const CALLBACK_PATH = "/healthcheck";

function generateTestEmail() {
  return `${faker.internet.username().toLowerCase()}+${Date.now()}@example.com`;
}

async function waitForHydration(page: Page) {
  await page.waitForLoadState("networkidle");
}

test.describe("MCP OAuth flow", () => {
  let testEmail: string;

  test.afterEach(async () => {
    if (testEmail) {
      await deleteTestUser(testEmail).catch(() => {});
    }
  });

  test("full flow: register client → login → consent → token → MCP call", async ({
    page,
    request,
    baseURL,
  }) => {
    testEmail = generateTestEmail();
    await createTestUser(testEmail, TEST_PASSWORD);

    // 1. Dynamic client registration (what claude.ai does on connect).
    const callbackUrl = `${baseURL}${CALLBACK_PATH}`;
    const registerRes = await request.post("/oauth/register", {
      data: {
        client_name: "Logbook E2E",
        redirect_uris: [callbackUrl],
        token_endpoint_auth_method: "none",
      },
    });
    expect(registerRes.ok()).toBeTruthy();
    const client = await registerRes.json();
    expect(client.client_id).toBeTruthy();

    // 2. Authorization request with PKCE → bounces to /login first.
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(8).toString("hex");
    const authorizeUrl =
      `/authorize?response_type=code&client_id=${encodeURIComponent(client.client_id)}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
      `&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;

    await page.goto(authorizeUrl);
    await page.waitForURL("**/login**");
    await waitForHydration(page);
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/^password/i).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    // 3. Back on /authorize: consent screen, scoped to the logged-in user.
    await page.waitForURL("**/authorize**");
    await expect(page.getByText("Logbook E2E")).toBeVisible();
    await expect(page.getByText(testEmail)).toBeVisible();
    await page.getByRole("button", { name: /approve/i }).click();

    // 4. Redirected to the callback with an authorization code.
    await page.waitForURL(`**${CALLBACK_PATH}**`);
    const callback = new URL(page.url());
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();
    expect(callback.searchParams.get("state")).toBe(state);

    // 5. Exchange the code for tokens (PKCE, public client).
    const tokenRes = await request.post("/oauth/token", {
      form: {
        grant_type: "authorization_code",
        client_id: client.client_id,
        redirect_uri: callbackUrl,
        code: code as string,
        code_verifier: verifier,
      },
    });
    expect(tokenRes.ok()).toBeTruthy();
    const tokens = await tokenRes.json();
    expect(tokens.access_token).toBeTruthy();

    // 6. Authenticated MCP request: initialize over Streamable HTTP.
    const initRes = await request.post("/mcp", {
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "logbook-e2e", version: "1.0.0" },
        },
      },
    });
    expect(initRes.status()).toBe(200);
    const initBody = await initRes.text();
    expect(initBody).toContain("Logbook");

    // 7. tools/list on the same MCP session shows the Logbook tool set.
    const sessionId = initRes.headers()["mcp-session-id"];
    expect(sessionId).toBeTruthy();
    const toolsRes = await request.post("/mcp", {
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-session-id": sessionId,
      },
      data: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    });
    expect(toolsRes.status()).toBe(200);
    const toolsBody = await toolsRes.text();
    for (const tool of [
      "list_vehicles",
      "get_vehicle_status",
      "whats_due",
      "log_work",
      "complete_reminder",
      "list_projects",
      "add_project_item",
      "update_item_status",
    ]) {
      expect(toolsBody).toContain(tool);
    }

    // 8. No token → no MCP.
    const anonRes = await request.post("/mcp", {
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      data: { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} },
    });
    expect(anonRes.status()).toBe(401);
  });
});
