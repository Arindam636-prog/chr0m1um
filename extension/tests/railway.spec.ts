import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import type { AgentCommandResponse } from "../lib/messaging/protocol";
import { RAILWAY_TASK } from "../lib/agent/railwayRehearsal";

const qwen = process.env.CONTEXTSHIELD_RAILWAY_QWEN === "1";
const ownServer = !qwen && process.env.CONTEXTSHIELD_RAILWAY_EXISTING !== "1";
test(`full railway ${qwen ? "Qwen-assisted run" : "rehearsal"} uses actual MV3 gate, approvals and signed ledger`, async () => {
  test.setTimeout(qwen ? 300_000 : 120_000);
  const root = resolve("../demo");
  const server = createServer((req, res) => {
    const path = resolve(
      root,
      `.${new URL(req.url ?? "/", "http://127.0.0.1").pathname}`,
    );
    if (!path.startsWith(`${root}/`)) {
      res.writeHead(403).end();
      return;
    }
    void readFile(path)
      .then((data) => {
        const mime: Record<string, string> = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".woff2": "font/woff2",
        };
        res.writeHead(200, {
          "content-type": mime[extname(path)] ?? "application/octet-stream",
        });
        res.end(data);
      })
      .catch(() => res.writeHead(404).end());
  });
  if (ownServer)
    await new Promise<void>((yes, no) => {
      server.once("error", no);
      server.listen(4173, "127.0.0.1", yes);
    });
  const extensionPath = resolve(
    process.env.CONTEXTSHIELD_EXTENSION_PATH ?? ".output/chrome-mv3",
  );
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 1440, height: 1050 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const popup = await context.newPage();
    await popup.goto(
      `chrome-extension://${new URL(worker.url()).hostname}/popup.html`,
    );
    const loaded: AgentCommandResponse = await popup.evaluate(() =>
      browser.runtime.sendMessage({ type: "LOAD_DEMO_PROFILE" }),
    );
    expect(loaded.ok).toBe(true);
    const target = await context.newPage();
    const outbound: string[] = [];
    target.on("request", (request) => {
      if (!request.url().startsWith("http://127.0.0.1:4173/"))
        outbound.push(request.url());
    });
    await target.goto("http://127.0.0.1:4173/railway.html");
    await target.bringToFront();
    await popup.evaluate(
      ({ task, rehearsal }) =>
        browser.runtime.sendMessage({
          type: "START_AGENT",
          task,
          rehearsal,
        }),
      { task: RAILWAY_TASK, rehearsal: !qwen },
    );
    let final: AgentCommandResponse | undefined;
    let approvals = 0;
    const deadline = Date.now() + (qwen ? 240_000 : 70_000);
    while (Date.now() < deadline) {
      final = await popup.evaluate(() =>
        browser.runtime.sendMessage({ type: "GET_AGENT_STATE" }),
      );
      if (!final) throw new Error("Missing extension state");
      if (final.state.pendingConfirmation?.kind === "CONFIRMATION") {
        const pending = final.state.pendingConfirmation;
        expect(pending.prompt).toContain("127.0.0.1:4173");
        const reply: AgentCommandResponse = await popup.evaluate(
          (request) => browser.runtime.sendMessage(request),
          {
            type: "CONFIRM_ACTION",
            actionId: pending.action.action_id,
            requestId: pending.requestId,
            confirmed: true,
          },
        );
        expect(reply.ok).toBe(true);
        approvals += 1;
      }
      if (!final.state.running) break;
      await new Promise((yes) => setTimeout(yes, 100));
    }
    await test
      .info()
      .attach("agent-result", {
        body: JSON.stringify(
          {
            phase: final?.state.phase,
            error: final?.state.error,
            result: final?.state.resultSummary,
            lastAction: final?.state.lastAction,
            metrics: final?.state.clientMetrics,
            timeline: final?.state.timeline,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
    expect(
      final?.state.error,
      JSON.stringify(final?.state.timeline),
    ).toBeNull();
    expect(final?.state.phase).toBe("COMPLETE");
    expect(approvals).toBeGreaterThanOrEqual(4);
    await expect(
      target.getByRole("heading", { name: "Simulated booking complete" }),
    ).toBeVisible();
    await expect(
      target.getByText("NETAJI EXPRESS", { exact: false }).first(),
    ).toBeVisible();
    expect(final?.state.serverPreview).not.toContain("traveller@example.test");
    if (qwen) {
      expect(final?.state.contextDelivery?.requests).toBeGreaterThan(0);
      expect(final?.state.sessionId).not.toBeNull();
    } else {
      expect(final?.state.contextDelivery?.requests).toBe(0);
      expect(final?.state.sessionId).toBeNull();
    }
    expect(outbound).toEqual([]);
    await popup
      .getByRole("button", { name: "Action ledger", exact: true })
      .click();
    await popup.getByRole("button", { name: "Verify current ledger" }).click();
    await expect(
      popup.getByText("Verified: every block and the signed checkpoint match."),
    ).toBeVisible();
    await popup.getByRole("button", { name: "Tamper with a copy" }).click();
    await expect(popup.getByText(/Tampering detected/)).toBeVisible();
  } finally {
    await context.close();
    if (ownServer)
      await new Promise<void>((yes, no) =>
        server.close((error) => (error ? no(error) : yes())),
      );
  }
});
