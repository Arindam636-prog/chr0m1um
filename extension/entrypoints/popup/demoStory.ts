import type { PublicAgentState } from '../../lib/messaging/protocol';

export const DEMO_URL = 'http://127.0.0.1:4173/judge-run.html';
export const DEMO_TASK = 'Compare the fares and select the cheapest morning fare. Then click Prepare ticket. Do not purchase anything.';

export function statusCopy(agent: PublicAgentState): { title: string; detail: string } {
  if (agent.error || agent.phase === 'FAILED') return { title: 'Stopped before going further', detail: agent.error ?? 'The task could not be completed safely.' };
  if (agent.phase === 'STOPPED') return { title: 'Stopped by you', detail: 'No more actions will be taken.' };
  if (agent.phase === 'COMPLETE') return { title: 'Task complete', detail: (agent.verifiedActions ?? 0) > 0 ? 'The browser checked the result of the action.' : 'The requested response is ready.' };
  if (agent.pendingConfirmation) return { title: 'Your permission is needed', detail: 'Nothing happens until you respond below.' };
  switch (agent.phase) {
    case 'OBSERVE': return { title: 'Reading this page', detail: 'The browser reads the page and screen locally.' };
    case 'SANITIZE': return { title: 'Hiding sensitive details', detail: 'Local models check text and pixels before sharing.' };
    case 'PLAN': return agent.contextDelivery?.status === 'LOCAL_ONLY'
      ? { title: 'Planning on your device', detail: 'This task does not need the server.' }
      : { title: 'Asking the server to plan', detail: 'Only the checked, sanitized context is allowed through.' };
    case 'EXECUTE': return { title: 'Acting in your browser', detail: 'The proposed action is checked before it runs.' };
    case 'VERIFY': return { title: 'Checking the result', detail: 'An attempted click is not treated as task completion.' };
    default: return { title: agent.running ? 'Starting local models' : 'Let AI help. Keep private details local.', detail: agent.running ? 'First use can take longer while models load.' : 'Give the agent a task on your current website.' };
  }
}

export function storySteps(agent: PublicAgentState) {
  const sanitized = Boolean(agent.serverPreview);
  const server = agent.contextDelivery?.status === 'ACKNOWLEDGED';
  const local = agent.contextDelivery?.status === 'LOCAL_ONLY';
  return [
    { label: 'Read', place: 'Device', done: sanitized, active: agent.running && agent.phase === 'OBSERVE' },
    { label: 'Hide', place: 'Device', done: sanitized, active: agent.running && agent.phase === 'SANITIZE' },
    { label: 'Plan', place: local ? 'Device' : 'Server', done: server || local, active: agent.running && agent.phase === 'PLAN' },
    { label: 'Act', place: 'Browser', done: (agent.verifiedActions ?? 0) > 0, active: agent.running && ['EXECUTE', 'VERIFY'].includes(agent.phase) },
  ];
}
