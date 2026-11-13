import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Constants } from '@babylonjs/core/Engines/constants';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { WebXRCamera } from '@babylonjs/core/XR/webXRCamera';
import type { WebXRSessionManager } from '@babylonjs/core/XR/webXRSessionManager';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';

/**
 * TEMPORARY head-tracking diagnostics, for a preview build only: a panel carried by the head
 * prints what the headset reports (raw viewer pose in the base reference space) next to
 * what the session camera ends up with, so a cancelled head pose can be told apart from a
 * pose that never moves.
 */
const W = 640;
const H = 320;
const f = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : String(n));
const yawOf = (q: { x: number; y: number; z: number; w: number }) =>
  (
    (Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)) * 180) /
    Math.PI
  ).toFixed(0);

export class XrDiagnostics {
  private readonly plane: Mesh;
  private readonly material: StandardMaterial;
  private readonly texture?: DynamicTexture;
  private spaceChanges = 0;
  private floor = 'local-floor ?';
  private shown = 0;

  constructor(
    scene: Scene,
    private readonly camera: WebXRCamera,
    private readonly manager: WebXRSessionManager,
    private readonly rig: TransformNode,
  ) {
    this.material = new StandardMaterial('xr-diag', scene);
    this.material.disableLighting = true;
    this.material.emissiveColor = Color3.White();
    this.material.backFaceCulling = false;
    this.material.depthFunction = Constants.ALWAYS;
    this.material.disableDepthWrite = true;
    if (typeof document !== 'undefined') {
      this.texture = new DynamicTexture('xr-diag', { width: W, height: H }, scene, false);
      this.texture.hasAlpha = true;
      this.material.diffuseTexture = this.texture;
      this.material.useAlphaFromDiffuseTexture = true;
    }
    this.plane = CreatePlane('xr-diag', { width: 0.4, height: 0.2 }, scene);
    this.plane.material = this.material;
    this.plane.parent = camera;
    this.plane.position.set(0.12, 0.12, -0.7);
    this.plane.renderingGroupId = 1;
    this.plane.isPickable = false;
    this.plane.alwaysSelectAsActiveMesh = true;
    manager.onXRReferenceSpaceChanged.add(() => this.spaceChanges++);
    void manager.session
      ?.requestReferenceSpace('local-floor')
      .then(() => (this.floor = 'local-floor ok'))
      .catch(() => (this.floor = 'local-floor REFUSÉ'));
  }

  update(now: number) {
    if (!this.texture || now - this.shown < 250) return;
    this.shown = now;
    const frame = this.manager.currentFrame;
    const base = this.manager.baseReferenceSpace;
    const raw = frame && base ? frame.getViewerPose(base) : null;
    const rp = raw?.transform.position;
    const ro = raw?.transform.orientation;
    const c = this.camera.position;
    const q = this.camera.rotationQuaternion;
    const eye = this.camera.rigCameras[0];
    this.camera.computeWorldMatrix();
    const world = this.camera.globalPosition;
    const lines = [
      `${this.floor} · suivi ${this.camera.trackingState} · émulé ${raw?.emulatedPosition ?? '-'}`,
      `brut   ${rp ? `${f(rp.x)} ${f(rp.y)} ${f(rp.z)} lacet ${yawOf(ro!)}` : 'aucune pose'}`,
      `caméra ${f(c.x)} ${f(c.y)} ${f(c.z)} lacet ${yawOf(q)}`,
      `œil    ${eye ? `${f(eye.position.x)} ${f(eye.position.y)} ${f(eye.position.z)}` : '-'} · vues ${this.camera.rigCameras.length}`,
      `monde  ${f(world.x)} ${f(world.y)} ${f(world.z)} · socle y ${f(this.rig.position.y)}`,
      `décalages d'espace ${this.spaceChanges}`,
    ];
    const context = this.texture.getContext();
    context.clearRect(0, 0, W, H);
    context.fillStyle = 'rgba(16, 16, 16, 0.8)';
    context.fillRect(0, 0, W, H);
    context.fillStyle = '#ffffff';
    context.font = '26px monospace';
    lines.forEach((line, i) => context.fillText(line, 14, 40 + i * 48));
    this.texture.update();
  }

  dispose() {
    this.plane.dispose();
    this.texture?.dispose();
    this.material.dispose();
  }
}
