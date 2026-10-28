/** Decoded file limits shared by browser selection and private storage validation. */
export const MAX_SOURCE_IMAGES = 6;
export const MAX_SOURCE_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_SOURCE_IMAGE_TOTAL_BYTES = 15 * 1024 * 1024;
// Base64 image data (20 MiB), source text with JSON escaping, and envelope overhead.
export const MAX_API_REQUEST_BYTES = 28 * 1024 * 1024;
