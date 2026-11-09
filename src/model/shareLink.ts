import {
  LinkPackError,
  packShareDocument,
  unpackShareDocument,
  type ShareDocument,
} from './linkPacker';

/**
 * Share link: `#p1:<base64url(deflate-raw(semantic pack))>`. The prefix isolates the
 * format for a future migration without reading ambiguity. The fragment is never
 * sent to the hosting server.
 */
export const LINK_PREFIX = 'p1';
const LINK_MARKER = `#${LINK_PREFIX}:`;
/** Strict base64url: `-` and `_`, no `=` padding. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export class ShareLinkError extends Error {}

export interface DecodedShareLink {
  document: ShareDocument;
  /** Canonical packed representation, uncompressed: basis of the silent comparison. */
  packed: Uint8Array;
}

export const isShareLink = (hash: string) => hash.startsWith(LINK_MARKER);

export async function encodeShareLinkHash(document: ShareDocument): Promise<string> {
  return LINK_MARKER + toBase64Url(await deflate(packShareDocument(document)));
}

export async function decodeShareLinkHash(hash: string): Promise<DecodedShareLink> {
  if (!isShareLink(hash)) throw new ShareLinkError('Ce lien n’est pas un projet partageable.');
  const encoded = hash.slice(LINK_MARKER.length);
  if (!BASE64URL.test(encoded)) throw new ShareLinkError('Ce lien est invalide.');
  let packed: Uint8Array;
  try {
    packed = await inflate(fromBase64Url(encoded));
  } catch {
    throw new ShareLinkError('Ce lien est tronqué ou illisible.');
  }
  try {
    const document = unpackShareDocument(packed);
    // Repacked at the current revision: an old link (revision 1) is thus compared with the local state.
    return { document, packed: packShareDocument(document) };
  } catch (error) {
    if (error instanceof LinkPackError)
      throw new ShareLinkError('Ce lien est tronqué ou illisible.');
    throw error;
  }
}

/** Canonical comparison of two states: same packed bytes, same data up to quantisation. */
export function samePackedState(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* ---------------------------------------------------------------------------------------------- */
/* Native deflate-raw — no uncompressed fallback, CompressionStream exists everywhere since 2023  */
/* ---------------------------------------------------------------------------------------------- */

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') throw new Error('Compression indisponible.');
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('Compression indisponible.');
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(encoded: string): Uint8Array {
  const binary = atob(encoded.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** How many hashes published by a tab are remembered to recognise its own stale URL. */
export const OWN_HASH_MEMORY_SIZE = 8;

/**
 * Whether the hash a tab loads with is one of its own stale snapshots rather than a link.
 * `published` lists the hashes this tab put in the URL, oldest first; `exitHash` is the hash
 * the page showed when it was left (null if unknown).
 *
 * - The last published hash is always the tab's own: reloading it must stay silent.
 * - An older published hash is the tab's own only if the page was not showing it when left.
 *   A reload can start with the URL of the moment it was requested while a debounced write
 *   publishes a newer hash before the page goes away; the deliberate return to an older link
 *   instead leaves that link displayed, and must still ask what to do.
 */
export function isOwnStaleHash(
  hash: string,
  published: readonly string[],
  exitHash: string | null,
): boolean {
  if (published.length === 0) return false;
  if (published[published.length - 1] === hash) return true;
  return exitHash !== hash && published.includes(hash);
}
