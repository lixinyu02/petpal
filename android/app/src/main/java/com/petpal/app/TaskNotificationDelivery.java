package com.petpal.app;

/** Recoverable ordering: prepared routing is not proof that Android displayed it. */
final class TaskNotificationDelivery {
    interface Operation { void run() throws Exception; }
    private TaskNotificationDelivery() { }
    static boolean deliver(long cursor, long sequence, Operation prepare, Operation post, Operation commit) throws Exception {
        if (sequence <= cursor) return false;
        prepare.run(); post.run(); commit.run(); return true;
    }
}
