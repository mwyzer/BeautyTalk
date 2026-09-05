import { z } from "zod";

export const problemDetailSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  instance: z.string(),
  request_id: z.string().optional(),
  errors: z.record(z.string(), z.string()).optional(),
});

export type ProblemDetail = z.infer<typeof problemDetailSchema>;