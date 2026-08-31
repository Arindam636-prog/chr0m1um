import { create } from 'zustand';

import type { AgentPhase } from '../messaging/protocol';

interface AgentState {
  task: string;
  origin: string | null;
  statuses: AgentPhase[];
  running: boolean;
  setTask: (task: string) => void;
  setResult: (origin: string | null, statuses: AgentPhase[]) => void;
  setRunning: (running: boolean) => void;
  reset: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  task: '',
  origin: null,
  statuses: [],
  running: false,
  setTask: (task) => set({ task }),
  setResult: (origin, statuses) => set({ origin, statuses }),
  setRunning: (running) => set({ running }),
  reset: () => set({ task: '', origin: null, statuses: [], running: false }),
}));
