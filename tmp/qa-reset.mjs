import { loadEnv } from "../server/env.mjs";
loadEnv();
const { createPasswordReset } = await import("../server/auth.js");
const r = await createPasswordReset("qa-date@example.test");
console.log("TOKEN=" + (r ? r.token : "NULL"));
process.exit(0);
