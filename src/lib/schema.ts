import { z } from 'zod';

export const blockSchema = z.union([
  z.object({ type: z.literal('markdown'), content: z.string().max(40000) }).strict(),
  z.object({ type: z.literal('diagram'), title: z.string().max(200), code: z.string().max(16000), caption: z.string().max(2000) }).strict(),
  z.object({
    type: z.literal('chart'), title: z.string().max(200), kind: z.enum(['line', 'bar']),
    xLabel: z.string().max(200), yLabel: z.string().max(200),
    labels: z.array(z.string().max(100)).min(1).max(100),
    series: z.array(z.object({ name: z.string().max(100), values: z.array(z.number()).min(1).max(100) }).strict()).min(1).max(6),
    caption: z.string().max(2000),
  }).strict(),
  z.object({ type: z.literal('interactive'), title: z.string().max(200), html: z.string().max(60000), caption: z.string().max(2000) }).strict(),
]);
export const explanationSchema = z.object({
  title: z.string().max(200), blocks: z.array(blockSchema).min(1).max(12),
  followUps: z.array(z.string().max(300)).max(3),
}).strict();
export type Explanation = z.infer<typeof explanationSchema>;
export type Block = z.infer<typeof blockSchema>;
export const rectSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) }).strict();
export type SelectionRect = z.infer<typeof rectSchema>;
export const contextSchema = z.object({
  documentId: z.string().max(300), documentName: z.string().max(300),
  page: z.number().int().min(1).max(100000), pageCount: z.number().int().min(1).max(100000),
  kind: z.enum(['text', 'region', 'page']), text: z.string().max(16000),
  pageText: z.string().max(24000), rects: z.array(rectSchema).max(200),
  image: z.string().max(6000000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).optional(),
}).strict();
export type ReadingContext = z.infer<typeof contextSchema>;
export const requestSchema = z.object({
  provider: z.string().min(1).max(80), question: z.string().min(1).max(8000),
  style: z.enum(['auto', 'simple', 'visual', 'interactive']), context: contextSchema,
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(16000) }).strict()).max(12),
}).strict();
export type ExplainRequest = z.infer<typeof requestSchema>;
export interface ProviderInfo { id: string; name: string; available: boolean; supportsImages: boolean; description: string }
export interface LibraryDocument { id: string; name: string; url?: string; size: number; local?: boolean }
export interface Message { id: string; role: 'user' | 'assistant'; text?: string; explanation?: Explanation; context?: ReadingContext; provider?: string; createdAt: number; demo?: boolean }
