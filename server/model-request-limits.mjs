// A Responses conversation can contain several bounded desktop screenshots.
// Keep the local transport and central executor relay on the same byte budget.
export const MODEL_REQUEST_BYTES = 16 * 1024 * 1024;
