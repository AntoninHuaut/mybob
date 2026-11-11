import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { footprintParts, type FurnitureItem } from './model';

/** One local, blurred alpha tile shared by every footprint in this layer. */
export function contactMaterial(scene: Scene): StandardMaterial {
  const size = 64,
    pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y) / 3;
      pixels[(y * size + x) * 4 + 3] = Math.round(255 * Math.min(1, edge * edge));
    }
  const texture = RawTexture.CreateRGBATexture(pixels, size, size, scene, false);
  texture.hasAlpha = true;
  const material = new StandardMaterial('furniture-contact', scene);
  material.diffuseTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.diffuseColor = material.emissiveColor = Color3.Black();
  material.disableLighting = true;
  material.alpha = 0.35;
  material.backFaceCulling = false;
  material.zOffset = -1;
  return material;
}

/** Keep the empty corner of sofas and dressing chains empty, including rotation. */
export function contactShadow(
  item: FurnitureItem,
  root: TransformNode,
  material: StandardMaterial,
): Mesh {
  const positions: number[] = [],
    indices: number[] = [],
    uvs: number[] = [];
  for (const polygon of footprintParts({ ...item, position: [0, 0], rotation: 0 })) {
    const cx = polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length;
    const cz = polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length;
    const start = positions.length / 3;
    for (const [i, [x, z]] of polygon.entries()) {
      positions.push(x + Math.sign(x - cx) * 0.04, 0, z + Math.sign(z - cz) * 0.04);
      uvs.push(
        ...[
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ][i],
      );
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.uvs = uvs;
  data.normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
  const mesh = new Mesh(`furniture-contact:${item.id}`, root.getScene());
  data.applyToMesh(mesh);
  mesh.parent = root;
  mesh.material = material;
  mesh.position.y = 0.002 - (item.elevation ?? 0);
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.metadata = { kind: 'furniture-contact', id: item.id };
  return mesh;
}
