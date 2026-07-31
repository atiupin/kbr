/**
 * SHA-256 of a whole buffer -- the hash every build gate compares on.
 *
 * Synchronous, which crypto.subtle is not: it returns a Promise, and one async
 * hash would spread through every caller down to the patcher for nothing.
 */

import { sha256 as digest } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const sha256 = (data: Uint8Array): string => bytesToHex(digest(data));
