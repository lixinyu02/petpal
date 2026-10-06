/** The selected executor is the only authority for automatic review support. */
export function canUseApprovalReview(capability) {
  return [1, 2].includes(capability?.version) && capability.available === true &&
    ['agent-model', 'native'].includes(capability.modelStrategy) &&
    capability.dynamicTools === 'bounded-audio-rules-with-manual-fallback';
}

export function canUseIndependentApprovalReview(capability) {
  return canUseApprovalReview(capability) && capability.version === 2 && capability.independentModel === true;
}

export function approvalReviewLabel(review) {
  if (!review || typeof review.status !== 'string') return '';
  const local = review.source === 'local-rule';
  const labels = {
    inProgress: local ? '正在审查音量操作' : '自动审查中',
    approved: local ? '音量操作已通过本地规则审查' : '自动审查已允许本次操作',
    denied: local ? '音量操作未通过本地规则审查' : '自动审查未放行本次操作',
    timedOut: '自动审查超时，请查看任务结果',
    aborted: '自动审查已取消',
  };
  return Object.hasOwn(labels, review.status) ? labels[review.status] : '';
}
