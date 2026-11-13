export function createWriteQueue() {
  const pending = new Map();
  function enqueue(key, operation) {
    const previous = pending.get(key) || Promise.resolve();
    const result = previous.then(operation);
    // The queue tail always resolves; each caller still receives its own failure.
    const tail = result.then(() => {}, () => {}).then(() => {
      if (pending.get(key) === tail) pending.delete(key);
    });
    pending.set(key, tail);
    return result;
  }
  return { enqueue, pending, drain: () => Promise.all([...pending.values()]) };
}
