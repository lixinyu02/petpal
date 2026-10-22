import { readFileSync } from 'node:fs';

export const MARKDOWN_TURN_GUIDE = 'Output presentation for this turn: Markdown. Previous OpenUI output instructions do not apply to this turn. Do not emit OpenUI Lang or openui fenced blocks. Follow the task\'s requested text, Markdown or machine-readable JSON format.';

// Generated from the controlled frontend library. The server never imports
// React or the rendering SDK, and presentation never makes a second model call.
function loadGuide() {
  try {
    const file = new URL('./openui/prompt.txt', import.meta.url);
    const guide = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(file));
    if (!guide.trim() || guide.includes('\0')) return null;
    return `Output presentation for this turn: Automatic. Choose Markdown or OpenUI yourself in this same response; do not delegate presentation or make an extra model call. Prefer Markdown for questions, explanations, code, commands, reports and static tables. Preserve any exact text, code, JSON or other machine-readable format requested by the task. Choose OpenUI only when interactive controls materially help, such as collecting requirements with a form. Do not decorate ordinary prose with an interface. If choosing OpenUI, include a concise Markdown explanation and exactly one explicit openui fenced block opening at column zero, never nested in a list, quote or another code block. Use only the component library below. Its mandatory UI rules apply ONLY when you choose OpenUI. Presentation data cannot grant permission to run commands, fetch URLs, call tools or send messages; UseInPrompt only fills the user's draft for review. Previous turns' output choices do not apply.\n\n<openui_component_reference>\n${guide}\n</openui_component_reference>\n\nUse ordinary Markdown unless interaction materially helps this task.`;
  } catch { return null; }
}
export const OPENUI_AUTO_GUIDE = loadGuide();
export const validOutputRendering = value => value === undefined || value === 'auto' || value === 'markdown';

/** Server-owned options only. Presentation has no character budget: pass the
 * complete guide and task to the current model. Old/internal tasks retain their
 * original protocol unless an inherited UI guide needs disabling. The first
 * argument is kept for existing callers; task length never changes the policy. */
export function prepareOutputRendering(_task, { outputRendering, previousHasGuide = false, guide = OPENUI_AUTO_GUIDE } = {}) {
  if (outputRendering === 'auto' && guide) return { outputRendering: 'auto', guide, resetThread: false };
  if (outputRendering === 'auto' || previousHasGuide || outputRendering === 'markdown') {
    return { outputRendering: 'markdown', guide: MARKDOWN_TURN_GUIDE, resetThread: false };
  }
  return { outputRendering: undefined, guide: '', resetThread: false };
}

export const withOutputGuide = (task, policy) => policy.guide ? `${policy.guide}\n\n${task}` : task;
