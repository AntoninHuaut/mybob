import { Color3 } from '@babylonjs/core/Maths/math.color';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import type { HouseProject } from '../model/types';
import { createSurfaceTextures } from './surfaceTextures';

/**
 * Relief and roughness maps, tiled in metres. The UVs of the walls are rewritten
 * in metres by `worldScaleUvs`, and the floor polygons already are, so one scale
 * here means one grain size across the whole house.
 */
function tile(texture: Texture, uScale: number, vScale = uScale) {
  texture.uScale = uScale;
  texture.vScale = vScale;
  return texture;
}

export function createMaterials(scene: Scene, finishes: HouseProject['finishes'] = {}) {
  const surfaces = createSurfaceTextures(scene);

  const plaster = new PBRMaterial('white-plaster', scene);
  plaster.albedoColor = Color3.FromHexString(finishes.wallColor ?? '#eeede8');
  plaster.roughness = 0.93;
  plaster.metallic = 0;
  plaster.maxSimultaneousLights = 6;
  // Half a metre per tile: plaster relief is a millimetre, so the grain has to be
  // fine enough that a wall reads as smooth from across the room.
  plaster.bumpTexture = tile(surfaces.plasterNormal, 2);
  plaster.microSurfaceTexture = tile(surfaces.plasterRoughness, 2);

  const parquet = finishes.floorFinish === 'blond-parquet';
  const wood = new PBRMaterial(parquet ? 'blond-parquet' : 'porcelain-oak', scene);
  wood.roughness = 0.72;
  wood.albedoColor = Color3.FromHexString(finishes.floorTint ?? '#ffffff');
  wood.metallic = 0;
  wood.maxSimultaneousLights = 6;
  // The parquet tile is 4.8 × 3.2 m, the same footprint as the albedo below.
  const repeatU = parquet ? 1.5 : 1;
  const repeatV = parquet ? 2 : 1;
  wood.bumpTexture = tile(surfaces.woodNormal, repeatU, repeatV);
  if (parquet) wood.bumpTexture.level = 0.12;
  wood.microSurfaceTexture = tile(surfaces.woodRoughness, repeatU, repeatV);

  // Scale all three maps together so the wood grain and joints follow the boards.
  const texture = new DynamicTexture(
    'oak-tiles-4.8x3.2m',
    { width: 1024, height: 1024 },
    scene,
    true,
  );
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  let seed = 1973;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  ctx.fillStyle = parquet ? '#d6b590' : '#b1a18a';
  ctx.fillRect(0, 0, 1024, 1024);
  for (let row = 0; row < 16; row++) {
    const stagger = row % 2 ? 128 : 0;
    for (let col = -1; col < 5; col++) {
      const x = col * 256 + stagger,
        y = row * 64;
      const tone = Math.floor(random() * (parquet ? 25 : 13));
      ctx.fillStyle = parquet
        ? `rgb(${210 + tone},${174 + tone},${134 + tone})`
        : `rgb(${202 + tone},${185 + tone},${159 + tone})`;
      const inset = parquet ? 0.35 : 1;
      ctx.fillRect(x + inset, y + inset, 256 - 2 * inset, 64 - 2 * inset);
      for (let grain = 0; grain < 30; grain++) {
        const gy = y + 3 + random() * 57;
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.bezierCurveTo(x + 70, gy + random() * 3, x + 160, gy - random() * 4, x + 256, gy);
        ctx.strokeStyle = `rgba(104,77,45,${0.025 + random() * 0.07})`;
        ctx.lineWidth = 0.5 + random();
        ctx.stroke();
      }
    }
  }
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 8;
  texture.update();
  wood.albedoTexture = tile(texture, repeatU, repeatV);

  const concrete = new PBRMaterial('garage-concrete', scene);
  concrete.albedoColor = Color3.FromHexString(finishes.garageColor ?? '#bcbdb6');
  concrete.roughness = 0.95;
  concrete.metallic = 0;
  // Garage floors are polygons, so their UVs are the parquet's 4.8 × 3.2 m tile.
  concrete.bumpTexture = tile(surfaces.concreteNormal, 4.8, 3.2);
  concrete.microSurfaceTexture = tile(surfaces.concreteRoughness, 4.8, 3.2);
  const frame = new PBRMaterial('joinery-white', scene);
  frame.albedoColor = Color3.FromHexString(finishes.joineryColor ?? '#f3f2ec');
  frame.roughness = 0.42;
  frame.metallic = 0;
  const glass = new PBRMaterial('clear-glass', scene);
  glass.albedoColor = Color3.FromHexString('#bfd7d0');
  glass.alpha = 0.18;
  glass.roughness = 0.14;
  glass.metallic = 0.12;
  glass.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  glass.backFaceCulling = false;
  const metal = new PBRMaterial('brushed-steel', scene);
  metal.albedoColor = Color3.FromHexString('#8d9694');
  metal.metallic = 0.8;
  metal.roughness = 0.3;
  // Brushing is a quarter-millimetre feature: four tiles per metre, not one.
  metal.bumpTexture = tile(surfaces.metalNormal, 4);
  metal.microSurfaceTexture = tile(surfaces.metalRoughness, 4);
  const slab = new PBRMaterial('slab-edge', scene);
  slab.albedoColor = Color3.FromHexString('#d5d2c8');
  slab.roughness = 1;
  slab.metallic = 0;
  const glow = new StandardMaterial('lamp-diffuser', scene);
  glow.diffuseColor = Color3.FromHexString('#fff4df');
  glow.emissiveColor = Color3.FromHexString('#ffe9c3');
  const selection = new StandardMaterial('selected-room', scene);
  selection.diffuseColor = Color3.FromHexString('#356c58');
  selection.emissiveColor = Color3.FromHexString('#19372b');
  selection.alpha = 0.12;
  selection.backFaceCulling = false;
  selection.disableLighting = true;
  /** Room paint: the plaster's grain in another colour, one material per colour. */
  const paints = new Map<string, PBRMaterial>();
  const paint = (color: string) => {
    let material = paints.get(color);
    if (!material) {
      material = plaster.clone(`paint:${color}`);
      material.albedoColor = Color3.FromHexString(color);
      // Two millimetres off the plaster, and drawn in front of it at equal depth.
      material.zOffset = -1;
      material.backFaceCulling = false;
      paints.set(color, material);
    }
    return material;
  };
  return {
    plaster,
    paint,
    wood,
    concrete,
    frame,
    glass,
    metal,
    slab,
    glow,
    selection,
    texture,
    surfaces,
  };
}
export type Materials = ReturnType<typeof createMaterials>;
