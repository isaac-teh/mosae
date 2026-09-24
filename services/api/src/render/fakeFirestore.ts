/**
 * A small in-memory stand-in for the two Firestore shapes the render leg uses:
 * `projects/{id}` and `projects/{id}/generations/{gid}`, read directly and
 * inside a transaction.
 *
 * It exists so the render leg is covered by the default suite, which runs
 * without an emulator. The emulator flow test drives the same code against real
 * Firestore; this one drives the branches that are awkward to provoke there —
 * a render service that dies mid-stream, a stream that ends saying nothing.
 */
export type FakeDoc = Record<string, unknown>;

class Snap {
  constructor(private readonly value: FakeDoc | undefined) {}
  get exists(): boolean {
    return this.value !== undefined;
  }
  data(): FakeDoc | undefined {
    return this.value ? { ...this.value } : undefined;
  }
  get(field: string): unknown {
    return this.value?.[field];
  }
}

class Ref {
  constructor(readonly path: string, private readonly store: Map<string, FakeDoc>) {}
  collection(name: string): Coll {
    return new Coll(`${this.path}/${name}`, this.store);
  }
  async get(): Promise<Snap> {
    return new Snap(this.store.get(this.path));
  }
}

class Coll {
  constructor(private readonly path: string, private readonly store: Map<string, FakeDoc>) {}
  doc(id: string): Ref {
    return new Ref(`${this.path}/${id}`, this.store);
  }
}

export class FakeFirestore {
  readonly docs = new Map<string, FakeDoc>();
  /** Every write, in order, so a test can count them rather than infer them. */
  readonly writes: Array<{ path: string; value: FakeDoc }> = [];

  collection(name: string): Coll {
    return new Coll(name, this.docs);
  }

  async runTransaction<T>(fn: (tx: {
    get(ref: Ref): Promise<Snap>;
    set(ref: Ref, value: FakeDoc): void;
    update(ref: Ref, value: FakeDoc): void;
  }) => Promise<T>): Promise<T> {
    return fn({
      get: async (ref) => new Snap(this.docs.get(ref.path)),
      set: (ref, value) => {
        this.docs.set(ref.path, { ...value });
        this.writes.push({ path: ref.path, value: { ...value } });
      },
      update: (ref, value) => {
        const merged = { ...(this.docs.get(ref.path) ?? {}), ...value };
        this.docs.set(ref.path, merged);
        this.writes.push({ path: ref.path, value: { ...value } });
      },
    });
  }
}
