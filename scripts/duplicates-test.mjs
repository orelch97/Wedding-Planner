import assert from "node:assert/strict";
import { phoneDigits, findDuplicatePhones, describeDuplicates } from "../src/lib/guestDuplicates.js";

const g = (id, phone, name = `guest ${id}`) => ({ id, phone, name });
const flagged = (guests) => [...findDuplicatePhones(guests).keys()].sort((a, b) => a - b);
let checks = 0;
const check = (name, fn) => {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
};

console.log("\nGuest duplicate mobile numbers\n");

check("digits ignore hyphens, spaces, brackets, dots and plus", () => {
  assert.equal(phoneDigits("050-123 4567"), "0501234567");
  assert.equal(phoneDigits("(050) 123.45.67"), "0501234567");
  assert.equal(phoneDigits("+972-50-1234567"), "972501234567");
});

check("the same number with and without a hyphen is a duplicate, both ways", () => {
  assert.deepEqual(flagged([g(1, "050-1234567"), g(2, "0501234567")]), [1, 2]);
});

check("other separators do not hide a duplicate", () => {
  assert.deepEqual(flagged([g(1, "050 123 4567"), g(2, "050.123.4567"), g(3, "(050)1234567")]), [1, 2, 3]);
});

check("different numbers are never flagged", () => {
  assert.deepEqual(flagged([g(1, "050-1234567"), g(2, "050-1234568"), g(3, "052-1234567")]), []);
});

check("a number that merely starts like another is not a duplicate", () => {
  assert.deepEqual(flagged([g(1, "050123"), g(2, "0501234567")]), []);
});

check("records without a number are never flagged, even together", () => {
  const empties = [g(1, ""), g(2, ""), g(3, undefined), g(4, null), g(5, "   "), g(6, "-"), g(7, "--"), g(8, "()")];
  assert.deepEqual(flagged(empties), []);
});

check("an empty record does not turn a unique number into a duplicate", () => {
  assert.deepEqual(flagged([g(1, "050-1234567"), g(2, ""), g(3, "-")]), []);
});

check("a record is never a duplicate of itself", () => {
  assert.deepEqual(flagged([g(1, "050-1234567")]), []);
});

check("three records with one number each list the other two", () => {
  const result = findDuplicatePhones([g(1, "050-1", "א"), g(2, "0501", "ב"), g(3, "05-01", "ג"), g(4, "052-9", "ד")]);
  assert.deepEqual([...result.keys()].sort(), [1, 2, 3]);
  assert.deepEqual(result.get(1).map((x) => x.id), [2, 3]);
  assert.equal(result.has(4), false);
});

check("two separate duplicate groups are tracked independently", () => {
  const result = findDuplicatePhones([g(1, "050-1"), g(2, "0501"), g(3, "052-2"), g(4, "0522")]);
  assert.deepEqual(result.get(1).map((x) => x.id), [2]);
  assert.deepEqual(result.get(3).map((x) => x.id), [4]);
});

check("non-string phone values do not crash", () => {
  assert.deepEqual(flagged([g(1, 501234567), g(2, "501234567"), g(3, {}), g(4, [])]), [1, 2]);
});

check("the tooltip names the other holders and abbreviates long lists", () => {
  assert.equal(describeDuplicates([g(1, "", "דנה")]), "מספר הנייד מופיע גם אצל: דנה");
  assert.equal(describeDuplicates([g(1, "", " "), g(2, "", "יוסי")]), "מספר הנייד מופיע גם אצל: ללא שם, יוסי");
  const many = ["א", "ב", "ג", "ד", "ה"].map((name, i) => g(i, "", name));
  assert.equal(describeDuplicates(many), "מספר הנייד מופיע גם אצל: א, ב, ג ועוד 2");
});

console.log(`\nGuest duplicate checks: ${checks} passed, 0 failed\n`);
