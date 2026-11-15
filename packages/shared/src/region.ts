import { z } from 'zod';
import { AuthoritySchema, CameraPoseSchema, HazardKindSchema, LngLatSchema } from './primitives';

/**
 * Static region data: everything about a region that does not change during an operation.
 * On disk a region pack is data/regions/<id>/{region,roads,facilities,cells,grid,units}.json.
 */

export const RegionConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** west, south, east, north */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  defaultCamera: CameraPoseSchema,
  hazards: z.array(HazardKindSchema),
  h3Resolution: z.number().int(),
  population: z.number().int().nonnegative(),
});
export type RegionConfig = z.infer<typeof RegionConfigSchema>;

export const RoadNodeSchema = z.object({ id: z.string(), position: LngLatSchema });
export type RoadNode = z.infer<typeof RoadNodeSchema>;

export const RoadClassSchema = z.enum(['motorway', 'arterial', 'collector', 'local']);
export type RoadClass = z.infer<typeof RoadClassSchema>;

export const RoadEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  geometry: z.array(LngLatSchema).min(2),
  lengthM: z.number().positive(),
  speedKph: z.number().positive(),
  class: RoadClassSchema,
  name: z.string().optional(),
  /** false = traversable in both directions */
  oneway: z.boolean(),
  bridgeId: z.string().optional(),
});
export type RoadEdge = z.infer<typeof RoadEdgeSchema>;

export const SeismicClassSchema = z.enum(['retrofitted', 'standard', 'vulnerable']);
export type SeismicClass = z.infer<typeof SeismicClassSchema>;

export const BridgeSchema = z.object({
  id: z.string(),
  name: z.string(),
  edgeIds: z.array(z.string()).min(1),
  seismicClass: SeismicClassSchema,
});
export type Bridge = z.infer<typeof BridgeSchema>;

export const FacilityKindSchema = z.enum([
  'hospital',
  'shelter',
  'fire_station',
  'ems_station',
  'eoc',
  'substation',
  'public_works_yard',
]);
export type FacilityKind = z.infer<typeof FacilityKindSchema>;

export const FacilitySchema = z.object({
  id: z.string(),
  kind: FacilityKindSchema,
  name: z.string(),
  position: LngLatSchema,
  /** nearest road graph node */
  nodeId: z.string(),
  capacity: z.number().int().nonnegative().optional(),
});
export type Facility = z.infer<typeof FacilitySchema>;

export const CellSchema = z.object({
  /** H3 index */
  id: z.string(),
  center: LngLatSchema,
  elevM: z.number(),
  population: z.number().int().nonnegative(),
});
export type Cell = z.infer<typeof CellSchema>;

export const GridSectionSchema = z.object({
  id: z.string(),
  feederId: z.string(),
  substationId: z.string(),
  /** null for the section fed directly by the substation */
  upstreamSectionId: z.string().nullable(),
  path: z.array(LngLatSchema).min(2),
  cellIds: z.array(z.string()),
  customers: z.number().int().nonnegative(),
  criticalFacilityIds: z.array(z.string()),
});
export type GridSection = z.infer<typeof GridSectionSchema>;

export const UnitKindSchema = z.enum([
  'swift_water',
  'usar',
  'engine',
  'als_ambulance',
  'bls_ambulance',
  'public_works',
  'utility_crew',
  'police',
]);
export type UnitKind = z.infer<typeof UnitKindSchema>;

export const UnitSeedSchema = z.object({
  id: z.string(),
  callsign: z.string(),
  kind: UnitKindSchema,
  authority: AuthoritySchema,
  homeFacilityId: z.string(),
});
export type UnitSeed = z.infer<typeof UnitSeedSchema>;

export const RegionStaticSchema = z.object({
  config: RegionConfigSchema,
  nodes: z.array(RoadNodeSchema),
  edges: z.array(RoadEdgeSchema),
  bridges: z.array(BridgeSchema),
  facilities: z.array(FacilitySchema),
  cells: z.array(CellSchema),
  grid: z.object({ sections: z.array(GridSectionSchema) }),
  units: z.array(UnitSeedSchema),
});
export type RegionStatic = z.infer<typeof RegionStaticSchema>;

/** Contents of roads.json in a region pack. */
export const RegionRoadsFileSchema = RegionStaticSchema.pick({
  nodes: true,
  edges: true,
  bridges: true,
});
export type RegionRoadsFile = z.infer<typeof RegionRoadsFileSchema>;
