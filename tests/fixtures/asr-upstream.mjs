// Subset of the deployed VibeVoice v1 /config and /api/protocol contract.
export const ASR_UPSTREAM_CONFIG = Object.freeze({ sample_rate: 24000, chunk_seconds: 2.933333333333333, window_seconds: 3.466666666666667,
  audio_format: 'pcm_f32le', channels: 1, max_session_seconds: 300, max_concurrent_sessions: 1 });
export const ASR_UPSTREAM_PROTOCOL = Object.freeze({ version: 1, transport: 'websocket', path: '/ws/asr',
  audio: { format: 'pcm_f32le', sample_rate: 24000, channels: 1, bytes_per_sample: 4, container: null },
  client_messages: [
    { order: 1, frame_type: 'text', format: 'json' },
    { order: 2, frame_type: 'binary', repeatable: true },
    { order: 3, frame_type: 'text', literal: 'end' },
  ],
  server_messages: { partial_example: { chunks: 1, text: '识别到的文字' }, final_example: { chunks: 2, text: '完整文字', done: true, total_chunks: 2 }, busy_close_code: 1013 },
});
export function asrFixtureResponse(url, { active = false, legacy = false } = {}) {
  const route = new URL(url).pathname;
  if (route === '/healthz') return Response.json({ status: 'ok', active_session: active, private: 'secret' });
  if (legacy) return new Response('not found', { status: 404 });
  if (route === '/config') return Response.json(ASR_UPSTREAM_CONFIG);
  if (route === '/api/protocol') return Response.json(ASR_UPSTREAM_PROTOCOL);
  throw new Error('Unexpected ASR fixture route');
}
