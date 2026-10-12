import { z } from "zod";

/** each fit factor is optional: off (0), normal (1) or high (2) */
const Importance = z.union([z.literal(0), z.literal(1), z.literal(2)]);

export const ProfileZ = z.object({
  product_name: z.string().min(1).max(80),
  one_line_pitch: z.string().min(1).max(400),
  problem_it_solves: z.string().min(1).max(1500),
  ideal_customer_signals: z.array(z.string().max(300)).max(20),
  target_languages: z.array(z.string().max(40)).max(30),
  target_ci_systems: z.array(z.string().max(40)).max(20),
  target_patterns: z.array(z.string().max(60)).max(20),
  competitors_and_adjacent: z.array(z.object({ name: z.string().max(80), detection: z.array(z.string().max(120)).max(20), verify: z.boolean() })).max(20),
  proof_points: z.array(z.string().max(300)).max(10),
  target_clouds: z.array(z.string().max(40)).max(20).optional(),
  importance: z
    .object(Object.fromEntries(["languages", "ci", "tests", "services", "monorepo", "patterns", "activity", "cloud"].map((k) => [k, Importance.optional()])))
    .optional(),
});
