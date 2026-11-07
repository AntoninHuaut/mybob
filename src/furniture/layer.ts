import type { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import earcut from 'earcut';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Plane } from '@babylonjs/core/Maths/math.plane';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { PointerEventTypes, type PointerInfo } from '@babylonjs/core/Events/pointerEvents';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { floorElevationAt } from '../model/geometry';
import type { Level, Point2 } from '../model/types';
import {
  dressingBounds,
  dressingPlacements,
  footprintParts,
  televisionDimensions,
  type FurnitureItem,
} from './model';
import { furnitureDistances, type SnapGuide, type SnapResult } from './checks';
import { circulationBands, CIRCULATION_TIGHT } from './circulation';
import { constrainGroupDrag, groupMembers } from './groups';
import { layoutLabels, type LabelRect } from '../ui/labelLayout';

export interface FurnitureOverlays {
  distances: boolean;
  clearances: boolean;
  openings: boolean;
}
interface Visual {
  root: TransformNode;
  signature: string;
  materials: StandardMaterial[];
}
interface Drag {
  id: string;
  offset: Point2;
  start: Point2;
  moved: boolean;
  floor: number;
  guide?: SnapGuide;
}

/** Metres throughout. Furniture front is local +Z; yaw follows Babylon rotation.y. */
export class FurnitureLayer {
  onSelect?: (id: string | undefined) => void;
  onEdit?: (id: string) => void;
  onChange?: (items: FurnitureItem[], final: boolean) => void;
  onDragState?: (dragging: boolean) => void;
  onDragBlocked?: (reason: string) => void;
  snapPlacement?: (item: FurnitureItem, items: FurnitureItem[]) => SnapResult;
  private items: FurnitureItem[] = [];
  private visuals = new Map<string, Visual>();
  private selected?: string;
  private mode: 'overview' | 'plan' | 'walk' = 'overview';
  private overlays: FurnitureOverlays = { distances: false, clearances: false, openings: false };
  private overlayRoot?: TransformNode;
  private circulation = false;
  private circulationRoot?: TransformNode;
  private circulationMaterials: StandardMaterial[] = [];
  private overlayMaterials: StandardMaterial[] = [];
  private observer: Observer<PointerInfo>;
  private labelObserver: Observer<Scene>;
  private drag?: Drag;
  private dragBlockReported = false;
  private disposed = false;
  private readonly release = () => this.finishDrag();

  constructor(
    private scene: Scene,
    private level: Level,
  ) {
    this.observer = scene.onPointerObservable.add((event) => this.pointer(event));
    this.labelObserver = scene.onBeforeRenderObservable.add(() => this.scalePlanLabels());
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerup', this.release);
      window.addEventListener('pointercancel', this.release);
      window.addEventListener('blur', this.release);
    }
  }

  setItems(items: FurnitureItem[]): void {
    this.items = structuredClone(items);
    const ids = new Set(items.map((item) => item.id));
    for (const [id, visual] of this.visuals) {
      if (!ids.has(id)) {
        this.destroyVisual(visual);
        this.visuals.delete(id);
      }
    }
    for (const item of this.items) {
      const signature = JSON.stringify([
        item.kind,
        item.width,
        item.depth,
        item.height,
        item.color,
        item.sofa,
        item.dressing,
        item.showerTray,
        item.showerPanels,
        item.tvDiagonalInches,
      ]);
      let visual = this.visuals.get(item.id);
      if (visual?.signature !== signature) {
        if (visual) this.destroyVisual(visual);
        visual = this.build(item, signature);
        this.visuals.set(item.id, visual);
      }
      for (const material of visual.materials)
        material.clipPlane =
          this.mode === 'plan' || this.scene.activeCamera?.mode === Camera.ORTHOGRAPHIC_CAMERA
            ? new Plane(0, 1, 0, -10000)
            : null;
      visual.root.position.set(
        item.position[0],
        floorElevationAt(this.level, item.position) + (item.elevation ?? 0),
        item.position[1],
      );
      visual.root.rotation.y = item.rotation;
      visual.root.computeWorldMatrix(true);
    }
    if (
      this.drag &&
      (!ids.has(this.drag.id) || groupMembers(this.items, this.drag.id).some((item) => item.locked))
    )
      this.finishDrag();
    if (this.selected && !ids.has(this.selected)) this.selected = undefined;
    this.drawOverlays();
    this.drawCirculation();
  }

  select(id: string | undefined): void {
    this.selected = this.items.some((item) => item.id === id) ? id : undefined;
    this.drawOverlays();
  }

  setMode(mode: 'overview' | 'plan' | 'walk'): void {
    this.finishDrag();
    this.mode = mode;
    for (const visual of this.visuals.values())
      for (const material of visual.materials)
        material.clipPlane =
          mode === 'plan' || this.scene.activeCamera?.mode === Camera.ORTHOGRAPHIC_CAMERA
            ? new Plane(0, 1, 0, -10000)
            : null;
    this.drawOverlays();
    this.drawCirculation();
  }

  setOverlays(overlays: FurnitureOverlays): void {
    this.overlays = { ...overlays };
    this.drawOverlays();
  }

  setCirculation(enabled: boolean): void {
    this.circulation = enabled;
    this.drawCirculation();
  }

  /** Passage strips are informative only; they never block a placement. */
  private drawCirculation(): void {
    this.circulationRoot?.dispose();
    this.circulationRoot = undefined;
    for (const material of this.circulationMaterials) material.dispose(false, true);
    this.circulationMaterials = [];
    if (!this.circulation || this.mode === 'walk') return;
    this.circulationRoot = new TransformNode('furniture:circulation', this.scene);
    for (const band of circulationBands(this.items, this.level)) {
      const item = this.items.find((candidate) => candidate.id === band.itemId);
      if (!item) continue;
      const y = floorElevationAt(this.level, item.position) + 0.03;
      const tight = band.distance < CIRCULATION_TIGHT;
      const color = tight ? new Color3(0.8, 0.24, 0.18) : new Color3(0.91, 0.56, 0.15);
      const strip = MeshBuilder.CreatePlane(
        'furniture:circulation-strip',
        {
          width: Math.max(0.04, band.rect.maxX - band.rect.minX),
          height: Math.max(0.04, band.rect.maxZ - band.rect.minZ),
        },
        this.scene,
      );
      strip.parent = this.circulationRoot;
      strip.rotation.x = Math.PI / 2;
      strip.position.set(
        (band.rect.minX + band.rect.maxX) / 2,
        y,
        (band.rect.minZ + band.rect.maxZ) / 2,
      );
      strip.isPickable = false;
      const material = new StandardMaterial('furniture:circulation-strip', this.scene);
      material.emissiveColor = color;
      material.diffuseColor = color;
      material.alpha = 0.28;
      material.disableLighting = true;
      this.circulationMaterials.push(material);
      strip.material = material;
      if (typeof document === 'undefined') continue;
      const texture = new DynamicTexture(
        'furniture:circulation-label',
        { width: 256, height: 64 },
        this.scene,
        false,
      );
      texture.hasAlpha = true;
      texture.drawText(
        `${Math.round(band.distance * 100)} cm`,
        null,
        44,
        'bold 32px sans-serif',
        '#ffffff',
        tight ? '#8a2a20' : '#7a5510',
        true,
      );
      const labelMaterial = new StandardMaterial('furniture:circulation-label', this.scene);
      labelMaterial.diffuseTexture = texture;
      labelMaterial.emissiveColor = Color3.White();
      labelMaterial.disableLighting = true;
      labelMaterial.backFaceCulling = false;
      this.circulationMaterials.push(labelMaterial);
      const label = MeshBuilder.CreatePlane(
        'furniture:circulation-label',
        { width: 0.72, height: 0.18 },
        this.scene,
      );
      label.parent = this.circulationRoot;
      label.position.set(
        (band.rect.minX + band.rect.maxX) / 2,
        y + 0.1,
        (band.rect.minZ + band.rect.maxZ) / 2,
      );
      label.material = labelMaterial;
      label.billboardMode = Mesh.BILLBOARDMODE_ALL;
      label.isPickable = false;
      label.metadata = { kind: 'furniture-overlay', measurementKind: 'gap', priority: 170 };
    }
  }

  /** Pixel obstacles for room labels in Plan: selected footprint and distance tags. */
  getLabelObstacles(
    project: (point: Point2, height?: number) => { x: number; y: number },
  ): LabelRect[] {
    const result: LabelRect[] = [];
    const selected = this.items.find((item) => item.id === this.selected);
    if (selected) {
      const points = footprintParts(selected)
        .flat()
        .map((p) => project(p));
      const minX = Math.min(...points.map((p) => p.x)),
        minY = Math.min(...points.map((p) => p.y));
      result.push({
        x: minX - 6,
        y: minY - 6,
        width: Math.max(...points.map((p) => p.x)) - minX + 12,
        height: Math.max(...points.map((p) => p.y)) - minY + 12,
      });
    }
    for (const mesh of this.overlayRoot?.getChildMeshes() ?? []) {
      if (mesh.name !== 'furniture:dimension-label' || !mesh.isVisible) continue;
      const p = mesh.getAbsolutePosition();
      const screen = project([p.x, p.z], p.y - this.level.elevation);
      result.push({ x: screen.x - 48, y: screen.y - 12, width: 96, height: 24 });
    }
    return result;
  }

  private scalePlanLabels(): void {
    if (this.mode !== 'plan') return;
    const camera = this.scene.activeCamera;
    if (!camera || !this.overlayRoot) return;
    const engine = this.scene.getEngine();
    const renderWidth = engine.getRenderWidth(),
      renderHeight = engine.getRenderHeight();
    const width = engine.getRenderingCanvas()?.clientWidth || renderWidth;
    const height = engine.getRenderingCanvas()?.clientHeight || renderHeight;
    if (width <= 0 || height <= 0) return;
    const span = Math.abs((camera.orthoTop ?? 1) - (camera.orthoBottom ?? -1));
    const meshes = this.overlayRoot
      .getChildMeshes()
      .filter((mesh) => mesh.name === 'furniture:dimension-label');
    const parentMatrix = this.overlayRoot.computeWorldMatrix(true);
    const inverseParent = Matrix.Invert(parentMatrix);
    const viewport = camera.viewport.toGlobal(renderWidth, renderHeight);
    const transform = camera.getViewMatrix().multiply(camera.getProjectionMatrix());
    const anchors = meshes.map((mesh) => {
      const anchor = Vector3.TransformCoordinates(
        Vector3.FromArray(mesh.metadata.anchor),
        parentMatrix,
      );
      return Vector3.Project(anchor, Matrix.IdentityReadOnly, transform, viewport);
    });
    const placements = layoutLabels(
      meshes.map((mesh, index) => ({
        id: String(index),
        x: (anchors[index].x * width) / renderWidth,
        y: (anchors[index].y * height) / renderHeight,
        width: 96,
        height: 24,
        priority: mesh.metadata.priority,
      })),
      [],
      { width, height },
    );
    for (const [index, mesh] of meshes.entries()) {
      const placement = placements[index],
        anchor = anchors[index];
      mesh.scaling.setAll((24 * span) / (height * 0.18));
      mesh.isVisible = placement.visible && anchor.z > 0 && anchor.z < 1;
      if (!mesh.isVisible) continue;
      const world = Vector3.Unproject(
        new Vector3(
          (placement.x * renderWidth) / width,
          (placement.y * renderHeight) / height,
          anchor.z,
        ),
        renderWidth,
        renderHeight,
        Matrix.IdentityReadOnly,
        camera.getViewMatrix(),
        camera.getProjectionMatrix(),
      );
      mesh.position.copyFrom(Vector3.TransformCoordinates(world, inverseParent));
      mesh.computeWorldMatrix(true);
    }
  }

  private build(item: FurnitureItem, signature: string): Visual {
    const root = new TransformNode(`furniture:${item.id}`, this.scene);
    root.metadata = { kind: 'furniture', id: item.id };
    const materials: StandardMaterial[] = [];
    const material = (name: string, color: Color3) => {
      const mat = new StandardMaterial(`furniture:${item.id}:${name}`, this.scene);
      mat.diffuseColor = color;
      mat.specularColor = new Color3(0.08, 0.08, 0.08);
      materials.push(mat);
      return mat;
    };
    const main = material(
      'finish',
      Color3.FromHexString(/^#[\da-f]{6}$/i.test(item.color) ? item.color : '#c4b39f'),
    );
    const soft = material('fabric', main.diffuseColor.scale(1.13));
    const wood = material('feet', new Color3(0.37, 0.28, 0.21));
    const pale = material('linen', new Color3(0.91, 0.9, 0.85));
    const metal = material('handles', new Color3(0.25, 0.27, 0.28));
    const w = item.width,
      d = item.depth,
      h = item.height;
    let part = 0;
    const box = (
      width: number,
      height: number,
      depth: number,
      x: number,
      y: number,
      z: number,
      mat = main,
      parent: TransformNode = root,
    ) => {
      const mesh = MeshBuilder.CreateBox(
        `furniture:${item.id}:part:${part++}`,
        {
          width: Math.max(0.005, width),
          height: Math.max(0.005, height),
          depth: Math.max(0.005, depth),
        },
        this.scene,
      );
      mesh.parent = parent;
      mesh.position.set(x, y, z);
      mesh.material = mat;
      mesh.checkCollisions = true;
      mesh.receiveShadows = true;
      mesh.metadata = { kind: 'furniture', id: item.id };
      return mesh;
    };
    const legs = (top: number, thickness = Math.min(w, d) * 0.08) => {
      for (const x of [-1, 1])
        for (const z of [-1, 1])
          box(
            thickness,
            top,
            thickness,
            x * (w / 2 - thickness),
            top / 2,
            z * (d / 2 - thickness),
            wood,
          );
    };
    if (item.kind === 'sofa' && item.sofa) {
      const { side, seatDepth, returnWidth, shape } = item.sofa;
      const sideSign = side === 'left' ? -1 : 1;
      const rowZ = -d / 2 + seatDepth / 2;
      const returnDepth = d - seatDepth;
      const returnX = sideSign * (w / 2 - returnWidth / 2);
      const returnZ = seatDepth / 2;
      const regionalLegs = (width: number, depth: number, x: number, z: number) => {
        const t = Math.min(width, depth, h) * 0.08;
        for (const sx of [-1, 1])
          for (const sz of [-1, 1])
            box(t, h * 0.12, t, x + sx * (width / 2 - t), h * 0.06, z + sz * (depth / 2 - t), wood);
      };
      regionalLegs(w, seatDepth, 0, rowZ);
      regionalLegs(returnWidth, returnDepth, returnX, returnZ);
      const join = -d / 2 + seatDepth;
      const outline = (inset: number): Point2[] =>
        [
          [-w / 2 + inset, -d / 2 + inset],
          [w / 2 - inset, -d / 2 + inset],
          [w / 2 - inset, join - inset],
          [-w / 2 + returnWidth - inset, join - inset],
          [-w / 2 + returnWidth - inset, d / 2 - inset],
          [-w / 2 + inset, d / 2 - inset],
        ].map(([x, z]) => [side === 'left' ? x : -x, z] as Point2);
      // One closed prism per upholstery layer: no internal seam or empty slit at the elbow.
      const upholstery = (
        name: string,
        polygon: Point2[],
        bottom: number,
        thickness: number,
        mat: StandardMaterial,
      ) => {
        const positions: number[] = [],
          indices: number[] = [],
          count = polygon.length;
        for (const y of [bottom, bottom + thickness])
          for (const [x, z] of polygon) positions.push(x, y, z);
        const caps = earcut(polygon.flat());
        const capNormals: number[] = [];
        VertexData.ComputeNormals(
          polygon.flatMap(([x, z]) => [x, 0, z]),
          caps,
          capNormals,
        );
        if (capNormals[1] < 0)
          for (let i = 0; i < caps.length; i += 3)
            [caps[i + 1], caps[i + 2]] = [caps[i + 2], caps[i + 1]];
        for (let i = 0; i < caps.length; i += 3) {
          indices.push(caps[i] + count, caps[i + 1] + count, caps[i + 2] + count);
          indices.push(caps[i], caps[i + 2], caps[i + 1]);
        }
        const signedArea = polygon.reduce((area, p, i) => {
          const q = polygon[(i + 1) % count];
          return area + p[0] * q[1] - q[0] * p[1];
        }, 0);
        for (let i = 0; i < count; i++) {
          const a = polygon[i],
            b = polygon[(i + 1) % count],
            start = positions.length / 3;
          positions.push(
            a[0],
            bottom,
            a[1],
            b[0],
            bottom,
            b[1],
            b[0],
            bottom + thickness,
            b[1],
            a[0],
            bottom + thickness,
            a[1],
          );
          const faces = signedArea > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
          indices.push(...faces.map((index) => start + index));
        }
        const normals: number[] = [];
        VertexData.ComputeNormals(positions, indices, normals);
        const data = new VertexData();
        data.positions = positions;
        data.indices = indices;
        data.normals = normals;
        const mesh = new Mesh(`furniture:${item.id}:${name}`, this.scene);
        data.applyToMesh(mesh);
        mesh.parent = root;
        mesh.material = mat;
        mesh.checkCollisions = true;
        mesh.receiveShadows = true;
        mesh.metadata = { kind: 'furniture', id: item.id };
      };
      upholstery('continuous-base', outline(0), h * 0.12, h * 0.28, main);
      upholstery(
        'continuous-seat',
        outline(Math.min(0.015, seatDepth * 0.02, returnWidth * 0.02, returnDepth * 0.02)),
        h * 0.4,
        h * 0.16,
        soft,
      );
      box(w, h * 0.6, seatDepth * 0.18, 0, h * 0.7, -d / 2 + seatDepth * 0.09);
      const arm = Math.min(w * 0.08, returnWidth * 0.15);
      for (const sx of [-1, 1]) {
        if (shape === 'corner' && sx === sideSign) continue;
        box(
          arm,
          h * 0.37,
          seatDepth * 0.83,
          sx * (w / 2 - arm / 2),
          h * 0.585,
          rowZ + seatDepth * 0.085,
        );
      }
      if (shape === 'corner')
        box(
          arm,
          h * 0.6,
          d - seatDepth * 0.18,
          sideSign * (w / 2 - arm / 2),
          h * 0.7,
          seatDepth * 0.09,
        );
    } else if (item.kind === 'sofa') {
      legs(h * 0.12);
      box(w, h * 0.28, d, 0, h * 0.26, 0);
      box(w * 0.84, h * 0.16, d * 0.77, 0, h * 0.48, d * 0.06, soft);
      box(w, h * 0.6, d * 0.18, 0, h * 0.7, -d * 0.41);
      for (const side of [-1, 1])
        box(w * 0.08, h * 0.37, d * 0.83, side * w * 0.46, h * 0.585, d * 0.085);
      // A discreet seam makes the seating direction legible from above.
      box(w * 0.012, h * 0.004, d * 0.7, 0, h * 0.563, d * 0.07);
    } else if (item.kind === 'bed') {
      legs(h * 0.12);
      box(w, h * 0.28, d, 0, h * 0.26, 0);
      box(w * 0.96, h * 0.27, d * 0.95, 0, h * 0.535, 0, pale);
      box(w, h, d * 0.05, 0, h / 2, -d * 0.475);
      box(w * 0.94, h * 0.035, d * 0.58, 0, h * 0.6875, d * 0.17, soft);
      for (const side of [-1, 1])
        box(w * 0.38, h * 0.12, d * 0.17, side * w * 0.23, h * 0.73, -d * 0.3, pale);
    } else if (
      item.kind === 'table' ||
      item.kind === 'desk' ||
      item.kind === 'coffee-table' ||
      item.kind === 'side-table'
    ) {
      const top = Math.min(h * 0.1, 0.07);
      legs(h - top);
      box(w, top, d, 0, h - top / 2, 0);
      if (item.kind === 'desk') box(w * 0.3, h * 0.27, d * 0.8, w * 0.32, h * 0.78, 0);
    } else if (item.kind === 'chair') {
      legs(h * 0.44);
      box(w, h * 0.09, d, 0, h * 0.485, 0);
      box(w, h * 0.47, d * 0.1, 0, h * 0.765, -d * 0.45);
    } else if (item.kind === 'ottoman') {
      legs(h * 0.12);
      box(w, h * 0.63, d, 0, h * 0.435, 0);
      box(w, h * 0.25, d, 0, h * 0.875, 0, soft);
    } else if (item.kind === 'bookcase') {
      const panel = Math.min(w, d, h) * 0.06;
      box(w, h, panel, 0, h / 2, -d / 2 + panel / 2);
      for (const sx of [-1, 1]) box(panel, h, d, sx * (w / 2 - panel / 2), h / 2, 0);
      for (let shelf = 0; shelf <= 4; shelf++)
        box(w, panel, d, 0, panel / 2 + (shelf * (h - panel)) / 4, 0);
    } else if (item.kind === 'tv-stand') {
      const panel = Math.min(w, d, h) * 0.08;
      legs(h * 0.12);
      for (const y of [h * 0.12 + panel / 2, h - panel / 2]) box(w, panel, d, 0, y, 0);
      box(w, h * 0.88, panel, 0, h * 0.56, -d / 2 + panel / 2);
      for (const x of [-w / 2 + panel / 2, -w / 6, w / 6, w / 2 - panel / 2])
        box(panel, h * 0.88, d, x, h * 0.56, 0);
      for (const sx of [-1, 1]) {
        box(w * 0.32, h * 0.8, panel, (sx * w) / 3, h * 0.56, d / 2 - panel / 2);
        box(w * 0.08, panel, panel, (sx * w) / 3, h * 0.7, d / 2 - panel / 2, metal);
      }
      box(w / 3, panel, d, 0, h * 0.56, 0);
    } else if (item.kind === 'tv') {
      const frame = material('screen-frame', new Color3(0.055, 0.06, 0.065));
      const screen = material('screen', new Color3(0.1, 0.14, 0.18));
      screen.specularColor = new Color3(0.25, 0.28, 0.3);
      if (item.tvDiagonalInches !== undefined) {
        const display = televisionDimensions(item.tvDiagonalInches);
        // The quoted diagonal describes the visible 16:9 screen, excluding frame and feet.
        const baseHeight = Math.min(0.06, Math.max(0, h - display.screenHeight));
        const screenBottom = Math.min(0.07, Math.max(0, h - display.screenHeight));
        const footHeight = Math.min(0.015, h * 0.1);
        box(w * 0.45, footHeight, d, 0, footHeight / 2, 0, frame);
        box(
          w * 0.08,
          Math.max(0.005, baseHeight - footHeight),
          d * 0.18,
          0,
          Math.max(footHeight, baseHeight / 2 + footHeight / 2),
          0,
          frame,
        );
        box(w, h - baseHeight, d * 0.2, 0, baseHeight + (h - baseHeight) / 2, -d * 0.1, frame);
        box(
          display.screenWidth,
          display.screenHeight,
          d * 0.015,
          0,
          screenBottom + display.screenHeight / 2,
          d * 0.0075,
          screen,
        );
      } else {
        // Preserve the appearance of imported TVs entered directly in metres.
        box(w * 0.45, h * 0.035, d, 0, h * 0.0175, 0, frame);
        box(w * 0.08, h * 0.09, d * 0.18, 0, h * 0.08, 0, frame);
        box(w, h * 0.9, d * 0.2, 0, h * 0.55, -d * 0.1, frame);
        box(w * 0.96, h * 0.84, d * 0.015, 0, h * 0.55, d * 0.0075, screen);
      }
    } else if (item.kind === 'wardrobe' || item.kind === 'cabinet') {
      box(w, h, d * 0.95, 0, h / 2, -d * 0.025);
      for (const side of [-1, 1]) {
        box(w * 0.492, h * 0.97, d * 0.015, side * w * 0.25, h * 0.5, d * 0.46);
        box(
          Math.min(0.025, w * 0.03),
          Math.min(0.2, h * 0.2),
          Math.min(0.025, d * 0.025),
          side * w * 0.055,
          h * 0.56,
          d * 0.485,
          metal,
        );
      }
    } else if (item.kind === 'dressing') {
      const panel = Math.min(w, d, h) * 0.05;
      const runDepth = item.dressing?.runDepth ?? d;
      const runs = item.dressing?.runs ?? [{ length: w }];
      const bounds = dressingBounds(runDepth, runs);
      // One open carcass per run, turned to follow the chain.
      for (const placement of dressingPlacements(runDepth, runs)) {
        const [dx, dz] = placement.direction;
        const rx = -dz,
          rz = dx;
        const startX = placement.start[0] - bounds.centerX;
        const startZ = placement.start[1] - bounds.centerZ;
        const run = new TransformNode(`furniture:${item.id}:run`, this.scene);
        run.parent = root;
        run.position.set(
          startX + (dx * placement.length) / 2 + (rx * runDepth) / 2,
          0,
          startZ + (dz * placement.length) / 2 + (rz * runDepth) / 2,
        );
        run.rotation.y = Math.atan2(-dz, dx);
        const length = placement.length;
        const depth = runDepth;
        const part = (
          width: number,
          height: number,
          thickness: number,
          x: number,
          y: number,
          z: number,
          mat = main,
        ) => box(width, height, thickness, x, y, z, mat, run);
        part(length, h, panel, 0, h / 2, -depth / 2 + panel / 2);
        for (const sx of [-1, 1]) part(panel, h, depth, sx * (length / 2 - panel / 2), h / 2, 0);
        part(length, panel, depth, 0, h - panel / 2, 0);
        part(length, panel, depth, 0, panel / 2, 0);
        part(length * 0.94, 0.025, 0.025, 0, h * 0.88, 0, metal);
        part(length * 0.94, panel, depth * 0.9, 0, h * 0.55, 0);
      }
    } else if (item.kind === 'toilet') {
      box(w * 0.5, h * 0.3, d * 0.35, 0, h * 0.15, -d * 0.1);
      box(w, h * 0.22, d * 0.6, 0, h * 0.41, d * 0.1);
      box(w * 0.98, h * 0.05, d * 0.55, 0, h * 0.545, d * 0.12, pale);
      box(w, h * 0.42, d * 0.24, 0, h * 0.72, -d * 0.36);
      box(w * 0.2, h * 0.02, d * 0.06, 0, h * 0.94, -d * 0.36, metal);
    } else if (item.kind === 'shower') {
      const tray = item.showerTray ?? 0.06;
      const panels = item.showerPanels ?? ['left'];
      const glass = material('glass', new Color3(0.72, 0.84, 0.88));
      glass.alpha = 0.32;
      glass.backFaceCulling = false;
      if (tray > 0) box(w, tray, d, 0, tray / 2, 0, pale);
      box(w * 0.12, 0.004, w * 0.12, 0, tray + 0.002, 0, metal);
      const panelHeight = h - tray;
      const panelY = tray + panelHeight / 2;
      if (panels.includes('back')) box(w, panelHeight, 0.02, 0, panelY, -d / 2 + 0.01, glass);
      if (panels.includes('front')) box(w, panelHeight, 0.02, 0, panelY, d / 2 - 0.01, glass);
      if (panels.includes('left')) box(0.02, panelHeight, d, -w / 2 + 0.01, panelY, 0, glass);
      if (panels.includes('right')) box(0.02, panelHeight, d, w / 2 - 0.01, panelY, 0, glass);
      box(0.04, h * 0.5, 0.04, 0, h * 0.65, -d / 2 + 0.05, metal);
      box(w * 0.22, 0.03, w * 0.22, 0, h * 0.92, -d / 2 + 0.15, metal);
    } else if (item.kind === 'bathtub') {
      box(w * 0.9, h * 0.12, d * 0.8, 0, h * 0.06, 0, pale);
      box(w, h, d * 0.1, 0, h / 2, -d * 0.45);
      box(w, h, d * 0.1, 0, h / 2, d * 0.45);
      for (const sx of [-1, 1]) box(w * 0.05, h, d * 0.8, sx * w * 0.475, h / 2, 0);
      box(0.04, h * 0.18, 0.04, 0, h * 0.91, -d * 0.42, metal);
    } else if (item.kind === 'vanity') {
      box(w, h * 0.82, d * 0.95, 0, h * 0.41, -d * 0.025);
      for (const side of [-1, 1]) {
        box(w * 0.48, h * 0.76, d * 0.02, side * w * 0.245, h * 0.41, d * 0.46);
        box(
          Math.min(0.02, w * 0.03),
          Math.min(0.16, h * 0.18),
          Math.min(0.02, d * 0.03),
          side * w * 0.06,
          h * 0.5,
          d * 0.475,
          metal,
        );
      }
      box(w * 0.72, h * 0.1, d * 0.66, 0, h * 0.87, d * 0.02, pale);
      box(0.035, h * 0.12, 0.035, 0, h * 0.93, -d * 0.18, metal);
    } else box(w, h, d, 0, h / 2, 0);
    return { root, signature, materials };
  }

  private pointer(event: PointerInfo): void {
    if (this.mode === 'walk' || this.disposed) return;
    if (event.type === PointerEventTypes.POINTERDOUBLETAP) {
      const mesh = event.pickInfo?.pickedMesh;
      if (mesh?.metadata?.kind === 'furniture') this.onEdit?.(mesh.metadata.id);
      return;
    }
    if (event.type === PointerEventTypes.POINTERUP) {
      this.finishDrag();
      return;
    }
    if (event.type === PointerEventTypes.POINTERDOWN && event.event.button === 0) {
      this.finishDrag();
      this.dragBlockReported = false;
      const picked = event.pickInfo?.pickedMesh;
      const id =
        picked?.metadata?.kind === 'furniture' ? (picked.metadata.id as string) : undefined;
      const item = this.items.find((candidate) => candidate.id === id);
      if (!item) {
        this.select(undefined);
        this.onSelect?.(undefined);
        return;
      }
      this.select(item.id);
      this.onSelect?.(item.id);
      const locked = groupMembers(this.items, item.id).find((member) => member.locked);
      if (locked) {
        this.reportBlockedDrag(
          `« ${locked.name} » est verrouillé. Déverrouillez-le pour déplacer cet ensemble.`,
        );
        return;
      }
      const floor = floorElevationAt(this.level, item.position);
      const point = this.groundPoint(floor);
      if (!point) return;
      this.drag = {
        id: item.id,
        offset: [item.position[0] - point.x, item.position[1] - point.z],
        start: [item.position[0], item.position[1]],
        moved: false,
        floor,
      };
      this.onDragState?.(true);
    } else if (event.type === PointerEventTypes.POINTERMOVE && this.drag) {
      const item = this.items.find((candidate) => candidate.id === this.drag!.id);
      const point = this.groundPoint(this.drag.floor);
      if (!item || !point) return;
      const position: Point2 = [point.x + this.drag.offset[0], point.z + this.drag.offset[1]];
      if (
        !this.drag.moved &&
        Math.hypot(position[0] - this.drag.start[0], position[1] - this.drag.start[1]) < 0.015
      )
        return;
      const locked = groupMembers(this.items, item.id).find((member) => member.locked);
      if (locked) {
        this.reportBlockedDrag(
          `« ${locked.name} » est verrouillé. Déverrouillez-le pour déplacer cet ensemble.`,
        );
        this.finishDrag();
        return;
      }
      let constrained = constrainGroupDrag(this.items, item.id, position, this.level);
      const beforeSnap = constrained.find((member) => member.id === item.id)!;
      const movedBeforeSnap =
        Math.hypot(
          beforeSnap.position[0] - item.position[0],
          beforeSnap.position[1] - item.position[1],
        ) >= 0.00001;
      if (this.snapPlacement) {
        const candidate = constrained.find((member) => member.id === item.id)!;
        const snapped = this.snapPlacement(
          structuredClone(candidate),
          structuredClone(constrained),
        );
        this.drag.guide = snapped.guide;
        constrained = constrainGroupDrag(constrained, item.id, snapped.item.position, this.level);
      }
      const anchor = constrained.find((member) => member.id === item.id)!;
      if (
        Math.hypot(anchor.position[0] - item.position[0], anchor.position[1] - item.position[1]) <
        0.00001
      ) {
        if (Math.hypot(position[0] - item.position[0], position[1] - item.position[1]) >= 0.015)
          this.reportBlockedDrag(
            movedBeforeSnap
              ? 'Accrochage actif : déplacez davantage le pointeur ou maintenez Alt pour suspendre l’aimantation.'
              : 'Déplacement arrêté par le bâtiment ou un meuble lié. Vérifiez les murs, le contour et la hauteur des membres de l’ensemble.',
          );
        return;
      }
      this.drag.moved = true;
      this.items = constrained;
      for (const member of groupMembers(this.items, item.id)) {
        const visual = this.visuals.get(member.id);
        visual?.root.position.set(
          member.position[0],
          floorElevationAt(this.level, member.position) + (member.elevation ?? 0),
          member.position[1],
        );
        visual?.root.computeWorldMatrix(true);
      }
      this.drawOverlays();
      this.onChange?.(structuredClone(this.items), false);
    }
  }

  private reportBlockedDrag(reason: string) {
    if (this.dragBlockReported) return;
    this.dragBlockReported = true;
    this.onDragBlocked?.(reason);
  }

  private groundPoint(y: number): Vector3 | undefined {
    if (!this.scene.activeCamera) return undefined;
    // The horizontal plane avoids jumps to the top of the dragged object or an intervening wall.
    const ray = this.scene.createPickingRay(
      this.scene.pointerX,
      this.scene.pointerY,
      null,
      this.scene.activeCamera,
    );
    if (Math.abs(ray.direction.y) < 1e-7) return undefined;
    const t = (y - ray.origin.y) / ray.direction.y;
    if (t < 0) return undefined;
    return ray.origin.add(ray.direction.scale(t));
  }

  private finishDrag(): void {
    if (!this.drag) return;
    const moved = this.drag.moved;
    this.drag = undefined;
    this.onDragState?.(false);
    if (moved) this.onChange?.(structuredClone(this.items), true);
  }

  private drawOverlays(): void {
    this.clearOverlays();
    const item = this.items.find((candidate) => candidate.id === this.selected);
    if (!item || this.mode === 'walk') return;
    this.overlayRoot = new TransformNode('furniture:overlays', this.scene);
    const root = this.overlayRoot;
    const y = floorElevationAt(this.level, item.position) + 0.035;
    const c = Math.cos(item.rotation),
      s = Math.sin(item.rotation);
    const point = (x: number, z: number) =>
      new Vector3(item.position[0] + x * c + z * s, y, item.position[1] - x * s + z * c);
    const line = (
      name: string,
      points: Vector3[],
      color = new Color3(0.12, 0.58, 0.45),
      label?: string,
    ) => {
      const mesh = MeshBuilder.CreateLines(name, { points }, this.scene);
      mesh.parent = root;
      mesh.color = color;
      mesh.isPickable = false;
      const measurementKind = name === 'furniture:wall-distance' ? 'gap' : undefined;
      const labelText = label && measurementKind ? `Écart ${label}` : label;
      mesh.metadata = { kind: 'furniture-overlay', label, labelText, measurementKind };
      mesh.renderingGroupId = 2;
      if (label && labelText)
        this.label(
          labelText,
          points[0].add(points[points.length - 1]).scale(0.5),
          root,
          name === 'furniture:wall-distance' ? 200 - Number.parseFloat(label) : 100,
          '#165347',
          measurementKind,
        );
    };
    const rectangle = (
      name: string,
      left: number,
      right: number,
      back: number,
      front: number,
      color?: Color3,
    ) =>
      line(
        name,
        [
          point(left, back),
          point(right, back),
          point(right, front),
          point(left, front),
          point(left, back),
        ],
        color,
      );
    const magnet = this.drag?.guide;
    if (magnet && this.drag?.moved)
      line(
        'furniture:snap-guide',
        [magnet.from, magnet.to].map(([x, z]) => new Vector3(x, y, z)),
        new Color3(0.93, 0.62, 0.16),
      );
    const hw = item.width / 2,
      hd = item.depth / 2;
    rectangle('furniture:selection', -hw, hw, -hd, hd);
    for (const member of groupMembers(this.items, item.id)) {
      if (member.id === item.id) continue;
      const memberY = floorElevationAt(this.level, member.position) + 0.04;
      for (const footprint of footprintParts(member)) {
        line(
          `furniture:group-selection:${member.id}`,
          [...footprint, footprint[0]].map(([x, z]) => new Vector3(x, memberY, z)),
          new Color3(0.2, 0.68, 0.55),
        );
      }
    }
    if (this.overlays.clearances && item.clearances) {
      const gap = item.clearances;
      rectangle(
        'furniture:clearance',
        -hw - gap.left,
        hw + gap.right,
        -hd - gap.back,
        hd + gap.front,
        new Color3(0.2, 0.6, 0.82),
      );
    }
    if (this.overlays.openings && item.opening) {
      const reach = item.opening.reach;
      const color = new Color3(0.91, 0.56, 0.15);
      // A conservative envelope covers the whole frontage, matching placement warnings.
      rectangle('furniture:opening', -hw, hw, hd, hd + reach, color);
    }
    if (!this.overlays.distances) return;
    for (const distance of furnitureDistances(item, this.level, this.items)) {
      if (distance.distance <= 0.02) continue;
      line(
        'furniture:wall-distance',
        [
          new Vector3(distance.from[0], y, distance.from[1]),
          new Vector3(distance.to[0], y, distance.to[1]),
        ],
        undefined,
        `${distance.distance.toFixed(2)} m`,
      );
    }
  }

  private label(
    text: string,
    position: Vector3,
    root: TransformNode,
    priority: number,
    background: string,
    measurementKind?: 'gap',
  ): void {
    // NullEngine tests and server-side validation have no canvas implementation.
    if (typeof document === 'undefined') return;
    const texture = new DynamicTexture(
      'furniture:dimension-label',
      { width: 256, height: 64 },
      this.scene,
      false,
    );
    texture.hasAlpha = true;
    texture.drawText(text, null, 44, 'bold 32px sans-serif', '#ffffff', background, true);
    const material = new StandardMaterial('furniture:dimension-label', this.scene);
    material.diffuseTexture = texture;
    material.emissiveColor = Color3.White();
    material.disableLighting = true;
    material.backFaceCulling = false;
    this.overlayMaterials.push(material);
    const label = MeshBuilder.CreatePlane(
      'furniture:dimension-label',
      { width: 0.72, height: 0.18 },
      this.scene,
    );
    label.parent = root;
    label.position.copyFrom(position);
    label.position.y += 0.16;
    label.material = material;
    label.billboardMode = Mesh.BILLBOARDMODE_ALL;
    label.isPickable = false;
    label.metadata = {
      kind: 'furniture-overlay',
      label: text,
      measurementKind,
      anchor: label.position.asArray(),
      priority,
    };
    label.renderingGroupId = 2;
  }

  private clearOverlays(): void {
    this.overlayRoot?.dispose();
    this.overlayRoot = undefined;
    for (const material of this.overlayMaterials) material.dispose(false, true);
    this.overlayMaterials = [];
  }

  private destroyVisual(visual: Visual): void {
    visual.root.dispose();
    for (const material of visual.materials) material.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.finishDrag();
    this.disposed = true;
    this.scene.onPointerObservable.remove(this.observer);
    this.scene.onBeforeRenderObservable.remove(this.labelObserver);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerup', this.release);
      window.removeEventListener('pointercancel', this.release);
      window.removeEventListener('blur', this.release);
    }
    this.clearOverlays();
    this.circulationRoot?.dispose();
    this.circulationRoot = undefined;
    for (const material of this.circulationMaterials) material.dispose(false, true);
    this.circulationMaterials = [];
    for (const visual of this.visuals.values()) this.destroyVisual(visual);
    this.visuals.clear();
  }
}
