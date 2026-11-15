import { z } from 'zod';

/** `[lng, lat]`, GeoJSON order. */
export const LngLatSchema = z.tuple([z.number(), z.number()]);
export type LngLat = z.infer<typeof LngLatSchema>;

/** `exercise` = training sandbox, `live` = real operation. */
export const ModeSchema = z.enum(['exercise', 'live']);
export type Mode = z.infer<typeof ModeSchema>;

export const HazardKindSchema = z.enum(['flash_flood', 'earthquake', 'tornado', 'hurricane']);
export type HazardKind = z.infer<typeof HazardKindSchema>;

/** The agency under whose rules an action is taken. */
export const AuthoritySchema = z.enum(['ema', 'fire_rescue', 'ems', 'utility', 'public_works']);
export type Authority = z.infer<typeof AuthoritySchema>;

export const RoleSchema = z.enum([
  'admin',
  'operator',
  'coordinator',
  'utility_operator',
  'observer',
]);
export type Role = z.infer<typeof RoleSchema>;

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: RoleSchema,
  authority: AuthoritySchema,
});
export type User = z.infer<typeof UserSchema>;

export const CameraPoseSchema = z.object({
  center: LngLatSchema,
  zoom: z.number(),
  pitch: z.number(),
  bearing: z.number(),
});
export type CameraPose = z.infer<typeof CameraPoseSchema>;

/** A value from 0 to 1 (confidence, reliability, progress). */
export const UnitIntervalSchema = z.number().min(0).max(1);

/** Severity 1 to 5, where 5 is the most severe. */
export const SeveritySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type Severity = z.infer<typeof SeveritySchema>;
