import {
  LinkPackError,
  packShareDocument,
  unpackShareDocument,
  type ShareDocument,
} from './linkPacker';

/**
 * Lien de partage : `#p1:<base64url(deflate-raw(pack sémantique))>`. Le préfixe isole le
 * format pour une migration future sans ambiguïté de lecture. Le fragment n'est jamais
 * envoyé au serveur d'hébergement.
 */
export const LINK_PREFIX = 'p1';
const LINK_MARKER = `#${LINK_PREFIX}:`;
/** Strict base64url : `-` et `_`, sans remplissage `=`. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export class ShareLinkError extends Error {}

export interface DecodedShareLink {
  document: ShareDocument;
  /** Représentation packée canonique, sans compression : base de la comparaison silencieuse. */
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
    // Repacké à la révision courante : un ancien lien (révision 1) se compare ainsi à l'état local.
    return { document, packed: packShareDocument(document) };
  } catch (error) {
    if (error instanceof LinkPackError)
      throw new ShareLinkError('Ce lien est tronqué ou illisible.');
    throw error;
  }
}

/** Comparaison canonique de deux états : mêmes octets packés, mêmes données à la quantification près. */
export function samePackedState(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* ---------------------------------------------------------------------------------------------- */
/* deflate-raw natif — pas de repli sans compression, CompressionStream existe partout depuis 2023  */
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
