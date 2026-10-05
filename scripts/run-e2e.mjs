import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectId = "demo-wedding-planner-e2e";
const expectedEnv = {
  GCLOUD_PROJECT: projectId,
  FIREBASE_PROJECT: projectId,
  VITE_FIREBASE_PROJECT_ID: projectId,
  VITE_FIREBASE_ENV: "test",
  VITE_USE_FIREBASE_EMULATORS: "true",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
  STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
  FUNCTIONS_EMULATOR_HOST: "127.0.0.1:5001",
};

for (const [key, expected] of Object.entries(expectedEnv)) {
  const current = process.env[key];
  let firebaseStorageHost = false;
  if (key === "STORAGE_EMULATOR_HOST" && current?.startsWith("http://")) {
    try {
      const storageUrl = new URL(current);
      firebaseStorageHost = storageUrl.protocol === "http:" &&
        storageUrl.host === expected &&
        storageUrl.pathname === "/" &&
        !storageUrl.search &&
        !storageUrl.hash;
    } catch {
      firebaseStorageHost = false;
    }
  }
  if (current && current !== expected && !firebaseStorageHost) {
    console.error(`E2E safety stop: ${key} was ${current}; expected ${expected}. No browser tests started.`);
    process.exit(2);
  }
}

const cli = fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url));
const result = spawnSync(process.execPath, [cli, "test", ...process.argv.slice(2)], {
  cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  stdio: "inherit",
  env: { ...process.env, ...expectedEnv },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
