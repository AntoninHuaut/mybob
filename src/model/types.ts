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
export interface Level {
  id: string;
  name: string;
  elevation: number;
  ceilingHeight: number;
  outline: Point2[];
  walls: Wall[];
  rooms: Room[];
  lights: { id: string; position: Point2; provisional?: boolean }[];
  spawn: { position: Point2; yaw: number };
}
export interface SiteRoof {
  id: string;
  /** Metres in the level coordinate system: x, height above level datum, z. */
  vertices: [number, number, number][];
  /** Planar polygon faces; indices into vertices. */
  faces: number[][];
  /** Rendered with the exterior plaster instead of the roof material. */
  gables?: number[][];
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
export interface HouseProject {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  units: 'm';
  site?: ProjectSite;
  finishes?: {
    wallColor?: string;
    floorTint?: string;
    garageColor?: string;
    joineryColor?: string;
  };
  source: { title: string; date?: string; status: string; notes: string[] };
  levels: Level[];
}
