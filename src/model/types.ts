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
export interface Level {
  id: string;
  name: string;
  elevation: number;
  ceilingHeight: number;
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
 * Chien-assis percé dans un pan : le rendu ouvre le versant sur l'emprise et
 * bâtit les joues et le toit. La face avant reste portée par le mur de fond du
 * niveau traversé, qui garde sa hauteur et sa fenêtre.
 */
export interface RoofDormer {
  id: string;
  /** Emprise au sol en plan (x, z) : deux coins opposés du rectangle, dans le repère du projet. */
  start: Point2;
  end: Point2;
  /** Mur de fond du niveau traversé : il porte la face avant et sa fenêtre. */
  wallId: string;
  /**
   * Pente du toit de la lucarne vers le faîtage, en montée par mètre de repli.
   * Sans valeur, le toit rejoint la couverture à l'arrière de l'emprise.
   */
  slope?: number;
}
/**
 * Fenêtre de toit posée sur un pan, sans volume de lucarne : le rendu ouvre le
 * versant sur la baie et pose le châssis dans le plan du rampant. Sa position
 * en profondeur se lit sur la coupe, pas sur le plan horizontal.
 */
export interface RoofWindow {
  id: string;
  /** Centre de la baie en plan (x, z) : un point du pan projeté au sol. */
  center: Point2;
  /** Largeur de la baie, horizontale, en mètres. */
  width: number;
  /** Hauteur de la baie mesurée dans le plan du pan, le long du rampant, en mètres. */
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
  /** Chiens-assis percés dans les pans de cette toiture. */
  dormers?: RoofDormer[];
  /** Fenêtres de toit percées dans les pans de cette toiture. */
  windows?: RoofWindow[];
}
export interface ProjectSite {
  /** Parcel in the same x/z coordinate system as the floor plan. */
  boundary: Point2[];
  /** Simplified flat ground height relative to the first level datum. */
  elevation: number;
  declaredArea?: number;
  facadeColor?: string;
  roofColor?: string;
  surfaces?: { id: string; kind: 'gravel' | 'path'; polygon: Point2[] }[];
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
