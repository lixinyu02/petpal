export const APPROVAL_REVIEW_STATUSES = Object.freeze(['inProgress', 'approved', 'denied', 'timedOut', 'aborted']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const boundedText = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);

/** This is progress only. It never grants execution permissions. */
export function validApprovalReview(value) {
  return object(value) && Object.keys(value).every(key => ['status', 'source', 'reviewId', 'targetItemId', 'rationale', 'riskLevel', 'userAuthorization'].includes(key)) &&
    APPROVAL_REVIEW_STATUSES.includes(value.status) && ['native', 'local-rule'].includes(value.source) &&
    ['reviewId', 'targetItemId', 'riskLevel', 'userAuthorization'].every(key => value[key] === undefined || boundedText(value[key], 256)) &&
    (value.rationale === undefined || boundedText(value.rationale, 2000));
}

export function approvalReviewCapability(apiMode, available = true, independentModel = apiMode) {
  return { available, modelStrategy: apiMode ? 'agent-model' : 'native', dynamicTools: 'bounded-audio-rules-with-manual-fallback', version: independentModel ? 2 : 1, ...(independentModel ? { independentModel: Boolean(available && apiMode) } : {}) };
}
