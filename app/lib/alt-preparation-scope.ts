/** A completed or in-flight wallet setup belongs to one exact RPC/account context. */
export class AltPreparationScope<T> {
  private current: { identity: string; connection: object; value: T | null; pending: Promise<T> | null } | null = null;
  select(identity: string, connection: object) {
    if (!this.current || this.current.identity !== identity || this.current.connection !== connection) {
      this.current = { identity, connection, value: null, pending: null };
    }
    return this.current;
  }
  assertCurrent(identity: string, connection: object): void {
    if (!this.current || this.current.identity !== identity || this.current.connection !== connection) throw new Error("Wallet setup context changed. Prepare the current basket again.");
  }
  run(identity: string, connection: object, prepare: (isCurrent: () => boolean) => Promise<T>): Promise<T> {
    const context = this.current;
    if (!context || context.identity !== identity || context.connection !== connection) {
      return Promise.reject(new Error("Wallet setup context changed. Prepare the current basket again."));
    }
    if (context.value !== null) return Promise.resolve(context.value);
    if (context.pending) return context.pending;
    const isCurrent = () => this.current === context;
    const task = prepare(isCurrent).then(value => {
      if (!isCurrent()) throw new Error("Wallet setup context changed. Prepare the current basket again.");
      context.value = value; return value;
    })
      .finally(() => { if (context.pending === task) context.pending = null; });
    context.pending = task;
    return task;
  }
}
