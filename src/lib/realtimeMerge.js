/**
 * Re-applies local changes made after a realtime merge was computed.
 *
 * `merged` was built from `snapshot`, a copy of local state that may be stale by the
 * time React runs the state updater. `current` is the latest committed local state.
 * Rows are compared by object identity: an unchanged row keeps the same object.
 */
export function rebaseOnLatest(merged, snapshot, current) {
  const snapshotById = new Map(snapshot.map((row) => [row.id, row]));
  const currentById = new Map(current.map((row) => [row.id, row]));
  const result = [];

  for (const row of merged) {
    const latest = currentById.get(row.id);
    // Deleted locally after the snapshot was taken.
    if (snapshotById.has(row.id) && !latest) continue;
    // Edited or added locally after the snapshot was taken.
    result.push(latest && latest !== snapshotById.get(row.id) ? latest : row);
  }

  const resultIds = new Set(result.map((row) => row.id));
  for (const row of current) {
    if (!resultIds.has(row.id) && row !== snapshotById.get(row.id)) result.push(row);
  }
  return result;
}
