import { DomActionBroker } from '../../lib/actions/broker';
import type { ContentResponse, ExtensionRequest } from '../../lib/messaging/protocol';
import {
  extractObservation,
  type PerceptionSnapshot,
} from '../../lib/perception/extractObservation';

export default defineContentScript({
  registration: 'runtime',
  matches: [],
  noScriptStartedPostMessage: true,
  main() {
    const protocolMarker = '2';
    const isolatedWindow = window as Window & {
      __contextshieldContentRuntimeV2?: boolean;
    };
    // A DOM dataset survives extension reloads while the old listener does not.
    // Keep the duplicate-injection guard in the isolated extension world so a
    // freshly reloaded build can attach to an already-open website.
    if (isolatedWindow.__contextshieldContentRuntimeV2) return;
    isolatedWindow.__contextshieldContentRuntimeV2 = true;
    document.documentElement.dataset.contextshieldContentReady = protocolMarker;

    let latestSnapshot: PerceptionSnapshot | null = null;
    const broker = new DomActionBroker(
      () => latestSnapshot,
      () => extractObservation(),
    );

    browser.runtime.onMessage.addListener(
      async (message: ExtensionRequest): Promise<ContentResponse | undefined> => {
        await Promise.resolve();
        if (message.type === 'PING_CONTENT_V2') {
          return {
            ok: true,
            kind: 'PING',
            origin: window.location.origin,
            protocolVersion: 2,
          };
        }
        if (message.type === 'OBSERVE_PAGE_V2') {
          try {
            latestSnapshot = extractObservation();
            const local = {
              observation: latestSnapshot.observation,
              privateValues: latestSnapshot.privateValues,
              visualHints: latestSnapshot.visualHints,
              ocrHints: latestSnapshot.ocrHints,
              safeVisualCrops: latestSnapshot.safeVisualCrops,
              fingerprint: latestSnapshot.fingerprint,
            };
            return { ok: true, kind: 'OBSERVATION', local };
          } catch (error) {
            const diagnostic =
              error instanceof Error
                ? error.message.replace(/[^A-Za-z0-9_:.-]/g, '_').slice(0, 160)
                : 'UNKNOWN';
            console.error('[ContextShield] Local perception failed', diagnostic);
            return { ok: false, error: `PERCEPTION_FAILED:${diagnostic}` };
          }
        }
        if (message.type === 'EXECUTE_ACTION_V2') {
          const confirmedActionIds = new Set<string>();
          if (message.confirmed) confirmedActionIds.add(message.action.action_id);
          const result = await broker.execute(message.action, {
              snapshotId: message.snapshotId,
              origin: message.origin,
              fingerprint: message.fingerprint,
              resolvedValue: message.resolvedValue,
              confirmedActionIds,
            });
          return { ok: true, kind: 'VERIFICATION', result };
        }
        return undefined;
      },
    );
  },
});
