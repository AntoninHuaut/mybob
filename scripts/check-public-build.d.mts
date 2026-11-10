export function verifyPublicBuild(
  directory: string,
  options?: { projectsDirectory?: URL },
): Promise<string[]>;
export function personalFingerprints(
  projectsDirectory?: URL,
): Promise<{ files: string[]; values: string[] }>;
