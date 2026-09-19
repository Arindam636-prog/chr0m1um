import { describe, expect, it, vi } from "vitest";
import type { AgentAction, SanitizedContext } from "@contextshield/shared";
import { privateFillGate } from "../lib/security/privateFillGate";
import { SecretVault } from "../lib/vault/secretVault";
import type { LocalPageObservation } from "../lib/privacy/types";

function fixture() {
  const vault = new SecretVault();
  const handle = vault.store("EMAIL", "synthetic@example.test");
  const action: AgentAction = {
    type: "TYPE_HANDLE",
    action_id: "act_1",
    snapshot_id: "snap_1",
    element_id: "el_1",
    handle,
    reason: "Untrusted planner prose",
  };
  const element = {
    id: "el_1",
    role: "textbox",
    tag: "input",
    text: null,
    label: "Email",
    input_type: "email",
    bbox: { x: 0, y: 0, width: 100, height: 20 },
    visible: true,
    enabled: true,
    selected: null,
    value_present: false,
    options: [],
    selected_option: null,
    control_value: null,
    dom_index: 0,
    value_handle: handle,
  };
  const context: SanitizedContext = {
    task: "Fill my email",
    origin: "https://example.test",
    snapshot_id: "snap_1",
    elements: [element],
    safe_visual_crops: [],
    privacy_summary: {},
  };
  const local: LocalPageObservation = {
    documentId: "doc_1",
    observation: {
      snapshot_id: "snap_1",
      origin: context.origin,
      url: `${context.origin}/`,
      viewport: { width: 1000, height: 700 },
      elements: [element],
      visual_regions: [],
      timestamp: 1,
    },
    fingerprint: "fp_1",
    privateValues: [],
    visualHints: [],
    ocrHints: [],
    safeVisualCrops: [],
  };
  const preflight = vi
    .fn()
    .mockResolvedValue({
      action_id: "act_1",
      success: true,
      page_changed: false,
      new_snapshot_required: false,
      error: null,
    });
  return {
    vault,
    action,
    context,
    local,
    preflight,
    tab: 5,
    run: 1,
    purpose: "Fill email",
    confirmed: true,
    current: () => true,
  };
}
describe("common local/server private-fill boundary", () => {
  it.each(["local", "server"])(
    "does not resolve or dispatch a secret without approval (%s planner)",
    async () => {
      const input = fixture();
      const resolve = vi.spyOn(input.vault, "resolve");
      expect(
        (await privateFillGate({ ...input, confirmed: false })).error,
      ).toBe("CONFIRMATION_REQUIRED");
      expect(resolve).not.toHaveBeenCalled();
      expect(input.preflight).not.toHaveBeenCalled();
    },
  );
  it("rejects a password handle aimed at an unrelated text field", async () => {
    const input = fixture();
    const password = input.vault.store("PASSWORD", "SYNTHETIC_ONLY");
    input.action = {
      ...input.action,
      type: "TYPE_HANDLE",
      element_id: "el_1",
      handle: password,
    };
    const resolve = vi.spyOn(input.vault, "resolve");
    expect((await privateFillGate(input)).error).toBe(
      "PRIVACY_ASSERTION_FAILED",
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(input.preflight).not.toHaveBeenCalled();
  });
  it("requires the exact local target and snapshot", async () => {
    const input = fixture();
    input.action = {
      ...input.action,
      type: "TYPE_HANDLE",
      element_id: "el_other",
      handle: "LOCAL_EMAIL_1",
    };
    expect((await privateFillGate(input)).error).toBe(
      "PRIVACY_ASSERTION_FAILED",
    );
    const stale = fixture();
    stale.local.observation.origin = "https://other.test";
    expect((await privateFillGate(stale)).error).toBe("STALE_SNAPSHOT");
  });
  it("blocks stale DOM or revoked runs before resolution", async () => {
    const input = fixture();
    const resolve = vi.spyOn(input.vault, "resolve");
    input.preflight.mockResolvedValue({
      success: false,
      error: "STALE_SNAPSHOT",
    });
    expect((await privateFillGate(input)).error).toBe("STALE_SNAPSHOT");
    expect(resolve).not.toHaveBeenCalled();
    const stopped = fixture();
    let current = true;
    stopped.preflight.mockImplementation(() => {
      current = false;
      return Promise.resolve({ success: true });
    });
    expect(
      (await privateFillGate({ ...stopped, current: () => current })).error,
    ).toBe("STALE_SNAPSHOT");
  });
  it("resolves only after preflight and consumes the grant", async () => {
    const input = fixture();
    const mint = vi.spyOn(input.vault, "approveOnce");
    const resolve = vi.spyOn(input.vault, "resolve");
    expect(await privateFillGate(input)).toEqual({
      value: "synthetic@example.test",
    });
    expect(input.preflight.mock.invocationCallOrder[0]).toBeLessThan(
      mint.mock.invocationCallOrder[0] ?? 0,
    );
    const authorization = resolve.mock.calls[0]?.[1];
    expect(input.vault.resolve("LOCAL_EMAIL_1", authorization)).toBeUndefined();
  });
});
