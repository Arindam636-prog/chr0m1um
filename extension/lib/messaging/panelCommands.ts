import { z } from 'zod';

export const PanelCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('GET_AGENT_STATE') }).strict(),
  z.object({ type: z.literal('GET_LEDGER') }).strict(),
  z.object({ type: z.literal('LOAD_DEMO_PROFILE') }).strict(),
  z.object({ type: z.literal('CHECK_BACKEND_HEALTH') }).strict(),
  z.object({ type: z.literal('CLEAR_SECRETS') }).strict(),
  z.object({ type: z.literal('STOP_AGENT') }).strict(),
  z.object({ type: z.literal('SET_SECRET'), kind: z.string().regex(/^[A-Z_]{2,30}$/), value: z.string().min(1).max(4000) }).strict(),
  z.object({ type: z.literal('START_AGENT'), task: z.string().min(1).max(4000), rehearsal: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('CONFIRM_ACTION'), actionId: z.string().max(100), requestId: z.uuid(), confirmed: z.boolean() }).strict(),
  z.object({ type: z.literal('ANSWER_CLARIFICATION'), actionId: z.string().max(100), answer: z.string().min(1).max(1000) }).strict(),
]);
