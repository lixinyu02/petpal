import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';

const failure = (status, message, code) => Object.assign(new Error(message), { status, code });

export function validateProjectDirectoryText(value) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > 4096 || !value.trim() || /[\x00-\x1f\x7f]/.test(value)) throw failure(400, '项目目录需要有效的绝对路径，最多 4096 个字符。', 'project_directory_invalid');
  return value;
}

/** Interpret on the execution computer, never on the coordinator's platform. */
export function normalizeProjectDirectory(value, platform = process.platform) {
  value = validateProjectDirectoryText(value);
  if (!value) return '';
  const windows = platform === 'win32', parser = windows ? path.win32 : path.posix;
  if (!(windows ? /^[a-zA-Z]:[\\/]/.test(value) : value.startsWith('/')) || !parser.isAbsolute(value)) throw failure(400, windows ? '请输入执行电脑的绝对目录，例如 C:\\Projects\\demo。' : '请输入执行电脑的绝对目录，例如 /home/user/projects/demo。', 'project_directory_invalid');
  return parser.normalize(value);
}

export function validateStoredProjectDirectory(value) {
  if (value === undefined) return;
  if (!validateProjectDirectoryText(value)) throw failure(400, '保存的项目目录无效。', 'project_directory_invalid');
  normalizeProjectDirectory(value, /^[a-zA-Z]:[\\/]/.test(value) ? 'win32' : 'linux');
}

/** Existing directories only. Symlinks cannot extend a workspace-only grant. */
export async function resolveProjectDirectory(value, { workspaceRoot, allowExternal = false, platform = process.platform } = {}) {
  const requested = normalizeProjectDirectory(value, platform);
  let resolved;
  try {
    resolved = await realpath(requested || workspaceRoot);
    if (!(await stat(resolved)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw failure(400, '项目目录不存在、不是文件夹或不可访问；请在所选执行电脑上检查。', 'project_directory_unavailable');
  }
  if (requested && !allowExternal) {
    let root;
    try { root = await realpath(workspaceRoot); } catch { throw failure(400, '默认工作区不可访问。', 'project_directory_unavailable'); }
    const parser = platform === 'win32' ? path.win32 : path.posix;
    const relative = parser.relative(root, resolved);
    if (relative === '..' || relative.startsWith(`..${parser.sep}`) || parser.isAbsolute(relative)) throw failure(403, '账号仅允许默认工作区内的目录；外部项目需要管理员授予完整 Agent 权限。', 'project_directory_forbidden');
  }
  return resolved;
}
