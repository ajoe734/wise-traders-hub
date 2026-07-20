import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeAdaptiveStrategy } from "./index.ts";

const AD = {
  enabled: true,
  escalate_to_standard_at: 1,
  escalate_to_aggressive_at: 2,
  reorder_variants_at: 3,
  exhaustive_at: 5,
  escalate_on_last_retry: true,
};

Deno.test("adaptive: disabled → passthrough", () => {
  const d = computeAdaptiveStrategy("fast", 99, { ...AD, enabled: false });
  assertEquals(d.effective_mode, "fast");
  assertEquals(d.triggers.length, 0);
  assertEquals(d.exhaustive, false);
});

Deno.test("adaptive: consec=0 → base 保持", () => {
  const d = computeAdaptiveStrategy("standard", 0, AD);
  assertEquals(d.effective_mode, "standard");
  assertEquals(d.triggers.length, 0);
});

Deno.test("adaptive: consec=1 fast → standard", () => {
  const d = computeAdaptiveStrategy("fast", 1, AD);
  assertEquals(d.effective_mode, "standard");
  assert(d.triggers.some((t) => t.rule === "escalate_to_standard"));
});

Deno.test("adaptive: consec=2 任何 mode → aggressive", () => {
  const d = computeAdaptiveStrategy("standard", 2, AD);
  assertEquals(d.effective_mode, "aggressive");
  assert(d.triggers.some((t) => t.rule === "escalate_to_aggressive"));
});

Deno.test("adaptive: consec=3 觸發變體重排（預處理變體優先）", () => {
  const d = computeAdaptiveStrategy("standard", 3, AD);
  assertEquals(d.variants[0], "otsu");
  assertEquals(d.variants[d.variants.length - 1], "raw");
  assert(d.triggers.some((t) => t.rule === "reorder_variants"));
});

Deno.test("adaptive: consec>=exhaustive_at → exhaustive=true", () => {
  const d = computeAdaptiveStrategy("standard", 5, AD);
  assertEquals(d.exhaustive, true);
  assert(d.triggers.some((t) => t.rule === "exhaustive"));
});

Deno.test("adaptive: 變體去重，且只允許合法名稱", () => {
  const d = computeAdaptiveStrategy("aggressive", 3, AD);
  const set = new Set(d.variants);
  assertEquals(set.size, d.variants.length);
  for (const v of d.variants) {
    assert(["otsu", "adaptive", "dilate", "loose_crop", "raw"].includes(v));
  }
});
