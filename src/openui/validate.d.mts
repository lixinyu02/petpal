export function validateOpenUI(source: string, options?: {streaming?: boolean}): {valid: boolean; errors: {code: string; message: string; source: string}[]};
export function copyBoundedData(value: unknown, maxBytes?: number): unknown;
