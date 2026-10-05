// One-time migration for deploying UUID-enforcing vendor rules.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { loadEnv } from "./lib/env.mjs";

loadEnv();

const argv = process.argv.slice(2);
const envArg = argv[argv.indexOf("--env") + 1] || "both";
const environments = envArg === "both" ? ["test", "prod"] : [envArg];
if (!environments.every((env) => ["test", "prod"].includes(env))) {
  throw new Error("--env must be test, prod, or both");
}

const { initializeApp, cert } = await import("firebase-admin/app");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
const serviceAccount = JSON.parse(readFileSync("./firebase-service-account.json", "utf8"));
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function migrateWedding(env, weddingRef) {
  const weddingId = weddingRef.id;
  const root = db.collection("envs").doc(env).collection("weddings").doc(weddingId);
  const migrationRef = db.collection("envs").doc(env).collection("migrations").doc(`vendor-ids-${weddingId}`);
  const lockId = randomUUID();

  const acquired = await db.runTransaction(async (tx) => {
    const state = await tx.get(migrationRef);
    if (state.get("complete") === true) return false;
    if (state.get("lockId") && Number(state.get("lockUntil")) > Date.now()) {
      throw new Error(`Migration already running for ${env}/${weddingId}`);
    }
    tx.set(migrationRef, {
      lockId,
      lockUntil: Date.now() + 150_000,
      startedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
  if (!acquired) return { skipped: true, vendors: 0, references: 0 };

  try {
    const vendors = await root.collection("vendors").get();
    const ids = new Map();
    const moves = [];
    for (const vendorDoc of vendors.docs) {
      const vendor = vendorDoc.data();
      if (vendor.migratedTo) {
        ids.set(vendorDoc.id, String(vendor.migratedTo));
        if (vendor.legacyId != null) ids.set(String(vendor.legacyId), String(vendor.migratedTo));
        continue;
      }
      if (uuidPattern.test(vendorDoc.id) && uuidPattern.test(String(vendor.id || ""))) {
        if (vendor.legacyId != null) ids.set(String(vendor.legacyId), vendorDoc.id);
        continue;
      }

      const id = randomUUID();
      ids.set(vendorDoc.id, id);
      moves.push({ ref: vendorDoc.ref, vendor, legacyId: vendorDoc.id, id });
    }

    for (let offset = 0; offset < moves.length; offset += 200) {
      const batch = db.batch();
      for (const move of moves.slice(offset, offset + 200)) {
        batch.create(root.collection("vendors").doc(move.id), {
          ...move.vendor,
          id: move.id,
          legacyId: move.legacyId,
          revision: Number(move.vendor.revision) || 1,
          updatedAt: FieldValue.serverTimestamp(),
        });
        batch.set(move.ref, {
          migratedTo: move.id,
          deletedAt: move.vendor.deletedAt || FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      await batch.commit();
    }

    let references = 0;
    for (const collectionName of ["budget", "files"]) {
      const records = await root.collection(collectionName).get();
      const changes = records.docs.flatMap((record) => {
        const current = record.get("vendorId");
        if (current == null) return [];
        const mapped = ids.get(String(current));
        const alreadyUuid = typeof current === "string" && uuidPattern.test(current);
        if (!mapped && alreadyUuid) return [];
        return [{ ref: record.ref, vendorId: mapped || null, revision: Number(record.get("revision")) || 0 }];
      });

      for (let offset = 0; offset < changes.length; offset += 450) {
        const batch = db.batch();
        for (const change of changes.slice(offset, offset + 450)) {
          const patch = { vendorId: change.vendorId, updatedAt: FieldValue.serverTimestamp() };
          if (collectionName === "budget") patch.revision = change.revision + 1;
          batch.update(change.ref, patch);
        }
        await batch.commit();
      }
      references += changes.length;
    }

    await migrationRef.set({
      complete: true,
      lockId: FieldValue.delete(),
      lockUntil: FieldValue.delete(),
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { skipped: false, vendors: moves.length, references };
  } catch (error) {
    await migrationRef.set({
      lockId: FieldValue.delete(),
      lockUntil: FieldValue.delete(),
    }, { merge: true });
    throw error;
  }
}

let totalWeddings = 0;
let totalVendors = 0;
let totalReferences = 0;
for (const env of environments) {
  const weddings = await db.collection("envs").doc(env).collection("weddings").get();
  for (const wedding of weddings.docs) {
    const result = await migrateWedding(env, wedding.ref);
    totalWeddings++;
    totalVendors += result.vendors;
    totalReferences += result.references;
    console.log(`  ${result.skipped ? "✓ already migrated" : "✓ migrated"} ${env}/${wedding.id}: ${result.vendors} vendors, ${result.references} links`);
  }
}
console.log(`\nComplete: ${totalWeddings} weddings, ${totalVendors} vendor IDs migrated, ${totalReferences} references updated.`);
