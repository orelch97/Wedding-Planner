import assert from "node:assert/strict";
import { rebaseOnLatest } from "../src/lib/realtimeMerge.js";

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const a = { id: 1, name: "A" };
const b = { id: 2, name: "B" };

check("a row added locally after the snapshot survives an incoming realtime update", () => {
  const snapshot = [a];
  const merged = [{ id: 1, name: "A" }];
  const added = { id: 2, name: "Imported" };
  const result = rebaseOnLatest(merged, snapshot, [a, added]);
  assert.deepEqual(result.map((r) => r.id), [1, 2]);
  assert.equal(result[1], added);
});

check("several rows added after the snapshot are all kept in order", () => {
  const added = [{ id: 2 }, { id: 3 }, { id: 4 }];
  const result = rebaseOnLatest([a], [a], [a, ...added]);
  assert.deepEqual(result.map((r) => r.id), [1, 2, 3, 4]);
});

check("a row edited locally after the snapshot keeps the local edit", () => {
  const edited = { ...a, name: "A edited" };
  const remote = { id: 1, name: "A from server" };
  const result = rebaseOnLatest([remote, b], [a, b], [edited, b]);
  assert.equal(result[0], edited);
});

check("a row deleted locally after the snapshot stays deleted", () => {
  const result = rebaseOnLatest([a, b], [a, b], [a]);
  assert.deepEqual(result.map((r) => r.id), [1]);
});

check("an unchanged row takes the remote version", () => {
  const remote = { id: 1, name: "A from partner" };
  const result = rebaseOnLatest([remote, b], [a, b], [a, b]);
  assert.equal(result[0], remote);
});

check("a remote delete of an unchanged row is honoured", () => {
  const result = rebaseOnLatest([b], [a, b], [a, b]);
  assert.deepEqual(result.map((r) => r.id), [2]);
});

check("a row added remotely by another device appears", () => {
  const remoteNew = { id: 9, name: "From partner" };
  const result = rebaseOnLatest([a, remoteNew], [a], [a]);
  assert.deepEqual(result.map((r) => r.id), [1, 9]);
});

check("a locally added row that the server already echoes is not duplicated", () => {
  const added = { id: 2, name: "Imported" };
  const echoed = { id: 2, name: "Imported" };
  const result = rebaseOnLatest([a, echoed], [a], [a, added]);
  assert.deepEqual(result.map((r) => r.id), [1, 2]);
  assert.equal(result[1], added);
});

check("with no local changes since the snapshot the merge is returned as-is", () => {
  const merged = [{ id: 1, name: "A2" }, b];
  assert.deepEqual(rebaseOnLatest(merged, [a, b], [a, b]), merged);
});

check("calling it twice with the same inputs gives the same result (StrictMode)", () => {
  const added = { id: 2 };
  const first = rebaseOnLatest([a], [a], [a, added]);
  const second = rebaseOnLatest([a], [a], [a, added]);
  assert.deepEqual(first, second);
});

console.log(`\nRealtime merge checks: ${passed} passed, 0 failed`);
