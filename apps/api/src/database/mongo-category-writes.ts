import type { Db } from "mongodb";

const pendingByDatabase = new WeakMap<Db, Map<string, Promise<void>>>();

// Standalone MongoDB has no multi-document transactions. Serialize category
// deletion and product assignment for a category within this API instance.
export async function withMongoCategoryWrite<T>(
  db: Db,
  id: string,
  write: () => Promise<T>,
): Promise<T> {
  let pending = pendingByDatabase.get(db);
  if (!pending) {
    pending = new Map();
    pendingByDatabase.set(db, pending);
  }
  const previous = pending.get(id) ?? Promise.resolve();
  const result = previous.then(write);
  const finished = result.then(() => undefined, () => undefined);
  pending.set(id, finished);
  try {
    return await result;
  } finally {
    if (pending.get(id) === finished) pending.delete(id);
  }
}
