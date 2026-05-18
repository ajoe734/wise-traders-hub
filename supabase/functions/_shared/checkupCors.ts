// Re-export of `_shared/cors.ts` for backward compatibility.
// Existing checkup-* functions import from here; new code should use `./cors.ts`.
export { corsHeaders, corsPreflight, jsonResponse, errorResponse } from './cors.ts';
