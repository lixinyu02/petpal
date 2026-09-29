/** Captures one executor connection; never resolves a new host for a running turn. */
export class RemoteCodexBridge {
  constructor(executors, entry) { this.delegate = executors.bind(entry); this.hostId = this.delegate.hostId; this.connectionId = this.delegate.connectionId; }
  run(args) { return this.delegate.run(args); }
  steer(args) { return this.delegate.steer(args); }
  approve(id, decision) { return this.delegate.approve(id, decision); }
}
