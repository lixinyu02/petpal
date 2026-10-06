/** The selected executor is the only authority for automatic review support. */
export function canUseApprovalReview(capability) {
  return capability?.version === 1 && capability.available === true &&
    ['agent-model', 'native'].includes(capability.modelStrategy) &&
    capability.dynamicTools === 'bounded-audio-rules-with-manual-fallback';
}

export function approvalReviewCapabilityNote(capability, model = '') {
  if (!canUseApprovalReview(capability)) {
    return capability?.available === false
      ? typeof capability.message === 'string' && capability.message.trim() ? capability.message : '这台执行电脑尚不支持自动审查，请升级客户端或改为“需要时询问”。'
      : '尚未确认这台执行电脑的自动审查能力，请刷新电脑列表或升级客户端后再选择。';
  }
  return capability.modelStrategy === 'agent-model'
    ? `命令审查沿用本轮 Agent 模型${model ? `（${model}）` : ''}，不另选模型。有限的系统音量操作按本地规则审查，其他主机工具仍需要你确认。`
    : '命令审查由执行电脑的 Codex 原生审查器处理。有限的系统音量操作按本地规则审查，其他主机工具仍需要你确认。';
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
