/**
 * Text safe to show: our own errors carry French messages, but browser exceptions
 * (quota, corrupted JSON, TypeError) are English and technical. Those get a French
 * sentence that points to the export; the detail goes to the console.
 */
export function userMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && !(error instanceof SyntaxError) && !(error instanceof TypeError)) {
    if (!(typeof DOMException !== 'undefined' && error instanceof DOMException))
      return error.message;
  }
  console.error(error);
  return `${fallback} Vos données locales sont peut-être illisibles ou le stockage est plein : exportez le projet.`;
}
