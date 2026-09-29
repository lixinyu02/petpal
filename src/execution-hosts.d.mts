type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;
export function readExecutionHost(storage: ReadStorage, scope: string): string;
export function saveExecutionHost(storage: WriteStorage, scope: string, value: string): void;
export function executionPlatform(platform: string): string;
export function resolveExecutionHostId(options?: { requestedId?: string; lockedId?: string; localHostId?: string; defaultHostId?: string }): string;
export function executionHostLock(agent?: { run?: { status: string; hostId?: string } | null; queue?: { hostId?: string }[] }, pending?: { payload: { hostId?: string } } | null): string;
