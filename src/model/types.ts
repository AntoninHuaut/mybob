export type Point2 = [number, number];
export type OpeningKind = 'door' | 'window' | 'sliding' | 'garage';
export interface Opening {
  id: string;
  kind: OpeningKind;
  offset: number;
  width: number;
  height: number;
  sill?: number;
  hinge?: 'start' | 'end';
  swing?: 1 | -1;
  exterior?: boolean;
  /** A `door` leaf built as a glazed French window instead of a solid slab. */
  glazed?: boolean;
  /** A `door` that hangs one leaf per jamb, meeting at the middle stile. */
  leaves?: 1 | 2;
}
export interface Wall {
  id: string;
  start: Point2;
  end: Point2;
  thickness: number;
  height?: number;
  exterior?: boolean;
  openings?: Opening[];
}
export interface Room {
  id: string;
  name: string;
  kind: 'living' | 'bedroom' | 'bathroom' | 'circulation' | 'garage' | 'storage';
  polygon: Point2[];
  label: Point2;
  viewpoint: Point2;
  /** Finished floor elevation relative to the level datum (metres). */
  floorOffset?: number;
  planArea?: number;
  note?: string;
}
export interface Stair {
  id: string;
  /** Axis of the straight flight, from the first riser to the last. */
  start: Point2;
  end: Point2;
  /** Clear width, centred on the axis. */
  width: number;
  /** Number of risers; the last one lands on the level above. */
  steps: number;
  /** Total rise from this level's floor to the level above, in metres. */
  rise: number;
  note?: string;
}
/**
 * A sloping part of a level's ceiling, under a roof slope. Along the foot line the
 * ceiling stands `height` above the level floor, and it rises by `rise` metres per
 * metre on the left of `start → end` as drawn on the plan (x to the right, z
 * downwards), until it meets the flat `ceilingHeight`. The slope runs the whole
 * length of the level; `gaps` interrupt it where a dormer opens the roof.
 */
export interface CeilingSlope {
  id: string;
  start: Point2;
  end: Point2;
  /** Ceiling height above the level floor along the foot line, in metres. */
  height: number;
  /** Rise per metre of horizontal distance from the foot line (1 for 45°). */
  rise: number;
  /**
   * Intervals along the foot line, in metres from `start`, where the slope does not
   * apply: under a dormer the ceiling stays at the flat height.
   */
  gaps?: [number, number][];
}
export interface Level {
  id: string;
  name: string;
  elevation: number;
  /** Flat ceiling height above the level floor; a sloping part lowers it locally. */
  ceilingHeight: number;
  /** Sloping parts of the ceiling, under the roof slopes of an attic level. */
  ceilingSlopes?: CeilingSlope[];
  outline: Point2[];
  walls: Wall[];
  rooms: Room[];
  /** Straight flights rising from this level to the one above. */
  stairs?: Stair[];
  /** Openings in this level's floor and slab, such as the stairwell arriving from below. */
  floorVoids?: Point2[][];
  lights: { id: string; position: Point2; provisional?: boolean }[];
  spawn: { position: Point2; yaw: number };
}
/**
 * Dormer pierced in a roof face: the renderer opens the slope over the footprint and
 * builds the cheeks and the roof. The front face stays carried by the back wall of the
 * crossed level, which keeps its height and its window.
 */
export interface RoofDormer {
  id: string;
  /** Footprint in plan (x, z): two opposite corners of the rectangle, in the project frame. */
  start: Point2;
  end: Point2;
  /** Back wall of the crossed level: it carries the front face and its window. */
  wallId: string;
  /**
   * Pitch of the dormer roof towards the ridge, as rise per metre of setback.
   * Without a value, the roof meets the covering at the back of the footprint.
   */
  slope?: number;
}
/**
 * Roof window set on a roof face, without a dormer volume: the renderer opens the
 * slope over the window and sets the frame in the plane of the rafter. Its depth
 * position is read on the section, not on the horizontal plan.
 */
export interface RoofWindow {
  id: string;
  /** Centre of the window in plan (x, z): a point of the roof face projected to the ground. */
  center: Point2;
  /** Width of the window, horizontal, in metres. */
  width: number;
  /** Height of the window measured in the roof face plane, along the rafter, in metres. */
  height: number;
}
export interface SiteRoof {
  id: string;
  /** Metres in the level coordinate system: x, height above level datum, z. */
  vertices: [number, number, number][];
  /** Planar polygon faces; indices into vertices. */
  faces: number[][];
  /** Rendered with the exterior plaster instead of the roof material. */
  gables?: number[][];
  /** Dormers pierced in the faces of this roof. */
  dormers?: RoofDormer[];
  /** Roof windows pierced in the faces of this roof. */
  windows?: RoofWindow[];
}
export type SiteSurfaceKind = 'gravel' | 'path' | 'terrace' | 'lawn';
export interface SiteSurface {
  id: string;
  /** `gravel` also stands for a "tout-venant" drive; `lawn` is the default ground made explicit. */
  kind: SiteSurfaceKind;
  polygon: Point2[];
  /** Terrace only: slab top above the terrain, in metres. Absent means flush with the ground. */
  height?: number;
}
/** A `gate` is drawn like a fence but lets the visitor through. */
export type SiteBoundaryKind = 'wall' | 'fence' | 'hedge' | 'gate';
export interface SiteBoundary {
  id: string;
  kind: SiteBoundaryKind;
  /** Open polyline in plan (x, z), at least two points, inside or on the parcel. */
  points: Point2[];
  /** Height above the terrain, in metres. */
  height: number;
  /** Width across the line; defaults per kind (`BOUNDARY_THICKNESS`). */
  thickness?: number;
}
export interface ProjectSite {
  /** Parcel in the same x/z coordinate system as the floor plan. */
  boundary: Point2[];
  /** Simplified flat ground height relative to the first level datum. */
  elevation: number;
  declaredArea?: number;
  facadeColor?: string;
  roofColor?: string;
  surfaces?: SiteSurface[];
  /** Linear garden elements: boundary walls, fences, hedges. */
  boundaries?: SiteBoundary[];
  roofs?: SiteRoof[];
  notes: string[];
}
export interface SolarSettings {
  latitude: number;
  longitude: number;
  /** Clockwise from the top of the plan (-Z); 90 degrees points toward +X. */
  northAngleDeg: number;
  /** Explicit IANA time zone, when provided; never inferred from personal context. */
  timeZone?: string;
  /** Optional place label supplied by the user. */
  label?: string;
  /** Optional selected solar instant, serialized by Date.toISOString(). */
  instant?: string;
}
export interface HouseProject {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  units: 'm';
  site?: ProjectSite;
  /** User-supplied geographic/orientation settings; absent unless configured. */
  solar?: SolarSettings;
  finishes?: {
    wallColor?: string;
    floorTint?: string;
    garageColor?: string;
    joineryColor?: string;
  };
  source: { title: string; date?: string; status: string; notes: string[] };
  levels: Level[];
}
