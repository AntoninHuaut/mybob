export interface TelevisionDimensions {
  width: number;
  depth: number;
  height: number;
  screenWidth: number;
  screenHeight: number;
}

/** 16:9 screen geometry in metres; chassis, feet and depth remain approximations. */
export function televisionDimensions(inches: number): TelevisionDimensions {
  if (!Number.isFinite(inches) || inches < 5 || inches > 300)
    throw new Error('La diagonale du téléviseur doit être comprise entre 5 et 300 pouces.');
  const diagonal = inches * 0.0254;
  const unit = diagonal / Math.hypot(16, 9);
  const screenWidth = 16 * unit,
    screenHeight = 9 * unit;
  return {
    width: screenWidth + 0.02,
    depth: 0.18,
    height: screenHeight + 0.02 + 0.06,
    screenWidth,
    screenHeight,
  };
}
