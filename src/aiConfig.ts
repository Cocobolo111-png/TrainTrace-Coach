import { z } from "zod";
export const models = ["deepseek-flash", "deepseek-v4-pro"] as const;
export const dimensions = ["progress", "next", "volume"] as const;
export type Dimension = (typeof dimensions)[number];
export const dimensionLabels: Record<Dimension, string> = {
  progress: "进步分析",
  next: "下次怎么练",
  volume: "训练量分析",
};
export const defaultDimensions: Dimension[] = ["progress", "next"];
export const AIOptionsSchema = z
  .object({
    provider: z.literal("deepseek"),
    model: z.enum(models),
    dimensions: z
      .array(z.enum(dimensions))
      .min(1)
      .max(3)
      .refine((xs) => new Set(xs).size === xs.length),
  })
  .strict();
export type AIOptions = z.infer<typeof AIOptionsSchema>;
export const byokEnabled = () => import.meta.env.MODE === "byok";
export const canonicalDimensions = (xs: Dimension[]) =>
  dimensions.filter((x) => xs.includes(x));
