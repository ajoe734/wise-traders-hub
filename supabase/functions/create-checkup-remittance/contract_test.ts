// Auto-generated contract test: OPTIONS/CORS + x-correlation-id propagation.
import {
  runPreflightTest, runInvalidBodyContract,
} from "../_shared/test_utils.ts";

const FN = "create-checkup-remittance";

Deno.test(`${FN} — OPTIONS preflight returns CORS`, async () => {
  await runPreflightTest(FN);
});

Deno.test(`${FN} — invalid POST keeps CORS + propagates x-correlation-id`, async () => {
  await runInvalidBodyContract(FN, { method: "POST" });
});
