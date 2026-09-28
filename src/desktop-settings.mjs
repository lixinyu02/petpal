export const reasoningEfforts = Object.freeze(['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

export function codexConfigDraft(config) {
  return {mode:config.mode,baseUrl:config.baseUrl,model:config.model,reasoningEffort:config.reasoningEffort ?? '',apiKey:'',clearApiKey:false};
}

/** Build only writable fields; credentials never originate from the public readback. */
export function codexConfigPatch(config, draft) {
  const key = draft.apiKey.trim();
  if (key && draft.clearApiKey) throw new Error('替换密钥和清除密钥只能选择一项。');
  const patch = { mode:draft.mode, baseUrl:draft.baseUrl.trim(), model:draft.model.trim(), reasoningEffort:draft.reasoningEffort ?? config.reasoningEffort ?? '', revision:config.revision };
  if (patch.mode === 'api' && (!patch.baseUrl || !patch.model)) throw new Error('请填写 Responses 服务地址和模型 ID。');
  if (key) patch.apiKey = key;
  if (draft.clearApiKey) patch.clearApiKey = true;
  return patch;
}

export function canControlPlayer(player, action) {
  if (!player) return false;
  if (action === 'open') return player.installed;
  return player.session && Array.isArray(player.controls) && player.controls.includes(action);
}

export function playerStateLabel(player) {
  if (!player.installed && !player.session) return '未检测到安装';
  if (!player.session) return '已安装 · 无可控媒体会话';
  const states = { playing:'播放中', paused:'已暂停', stopped:'已停止', closed:'已关闭', opened:'已打开' };
  return states[String(player.state).toLowerCase()] || '媒体会话已连接';
}

export function canOpenMusicSite(status, profileId) {
  return !!status?.ready && !!profileId && status.selectedProfileId === profileId
    && status.profiles.some(profile => profile.id === profileId && profile.connected);
}
