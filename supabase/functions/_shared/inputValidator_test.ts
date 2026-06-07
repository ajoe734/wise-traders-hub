// Engine-level unit tests for `validateInput` — the schema validator that all
// `validateInput`-protected edge functions share. Pure logic, no network.
//
// Run: lovable-exec test → Deno test for *_test.ts under supabase/functions/.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateInput, validationResponse, type FieldSpec } from "./inputValidator.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*" };

function keys(issues: ReturnType<typeof validateInput>) {
  return issues.map((i) => i.key).sort();
}

Deno.test("required: missing / empty / null / undefined all flagged", () => {
  const fields: Record<string, FieldSpec> = { a: { required: true, type: "string" } };
  for (const v of [undefined, null, ""]) {
    const out = validateInput({ fields, source: { a: v } });
    assertEquals(out.length, 1, `value ${JSON.stringify(v)} should fail`);
    assertEquals(out[0].reason, "缺少必填欄位");
  }
});

Deno.test("required false + missing → no issue", () => {
  const out = validateInput({
    fields: { a: { required: false, type: "string" } },
    source: {},
  });
  assertEquals(out.length, 0);
});

Deno.test("type mismatch flagged per primitive", () => {
  const cases: Array<[FieldSpec["type"], unknown]> = [
    ["string", 123],
    ["number", "x"],
    ["number", NaN],
    ["number", Infinity],
    ["boolean", "true"],
    ["array", { 0: "x" }],
    ["object", []],
    ["object", "x"],
  ];
  for (const [type, value] of cases) {
    const out = validateInput({
      fields: { a: { required: true, type } },
      source: { a: value },
    });
    assertEquals(out.length, 1, `${type}=${JSON.stringify(value)}`);
    assert(out[0].reason.startsWith("型別錯誤"));
  }
});

Deno.test("acceptTypes: alt type passes", () => {
  const fields: Record<string, FieldSpec> = {
    s: { required: true, type: "string", acceptTypes: ["array"] },
  };
  assertEquals(validateInput({ fields, source: { s: ["a"] } }).length, 0);
  assertEquals(validateInput({ fields, source: { s: "ok" } }).length, 0);
  assertEquals(validateInput({ fields, source: { s: 5 } }).length, 1);
});

Deno.test("minLength on string", () => {
  const fields: Record<string, FieldSpec> = { a: { required: true, type: "string", minLength: 3 } };
  assertEquals(validateInput({ fields, source: { a: "ab" } }).length, 1);
  assertEquals(validateInput({ fields, source: { a: "   " } }).length, 1, "trim-then-measure");
  assertEquals(validateInput({ fields, source: { a: "abc" } }).length, 0);
});

Deno.test("minItems on array", () => {
  const fields: Record<string, FieldSpec> = { a: { required: true, type: "array", minItems: 2 } };
  assertEquals(validateInput({ fields, source: { a: [] } }).length, 1);
  assertEquals(validateInput({ fields, source: { a: [1] } }).length, 1);
  assertEquals(validateInput({ fields, source: { a: [1, 2] } }).length, 0);
});

Deno.test("pattern: regex enforced", () => {
  const fields: Record<string, FieldSpec> = {
    code: { required: true, type: "string", pattern: /^\d{4,6}[A-Z]?$/i },
  };
  for (const bad of ["abc", "12", "12345678", "2330!"]) {
    assertEquals(validateInput({ fields, source: { code: bad } }).length, 1, bad);
  }
  for (const ok of ["2330", "00878", "1101B"]) {
    assertEquals(validateInput({ fields, source: { code: ok } }).length, 0, ok);
  }
});

Deno.test("oneOf: enum enforced", () => {
  const fields: Record<string, FieldSpec> = {
    mode: { required: true, type: "string", oneOf: ["a", "b"] },
  };
  assertEquals(validateInput({ fields, source: { mode: "c" } }).length, 1);
  assertEquals(validateInput({ fields, source: { mode: "a" } }).length, 0);
});

Deno.test("altKey: fallback when primary missing", () => {
  const fields: Record<string, FieldSpec> = {
    userPrompt: { required: true, type: "string", minLength: 1, altKey: "prompt" },
  };
  assertEquals(validateInput({ fields, source: { prompt: "hi" } }).length, 0);
  assertEquals(validateInput({ fields, source: {} }).length, 1);
});

Deno.test("nested object: child fields validated", () => {
  const fields: Record<string, FieldSpec> = {
    report: {
      required: true,
      type: "object",
      nested: {
        code: { required: true, type: "string", pattern: /^\d{4,6}$/ },
        text: { required: true, type: "string", minLength: 5 },
      },
    },
  };
  const out = validateInput({ fields, source: { report: { code: "abc", text: "hi" } } });
  assertEquals(keys(out), ["code", "text"]);
});

Deno.test("multiple field errors aggregated", () => {
  const fields: Record<string, FieldSpec> = {
    a: { required: true, type: "string" },
    b: { required: true, type: "number" },
  };
  const out = validateInput({ fields, source: {} });
  assertEquals(out.length, 2);
});

Deno.test("validationResponse: shape + status + CORS + dual error key", async () => {
  const issues = validateInput({
    fields: { a: { required: true, type: "string", label: "A" } },
    source: {},
  });
  const res = validationResponse(issues, corsHeaders);
  assertEquals(res.status, 400);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  const body = await res.json();
  assertEquals(body.code, "INVALID_INPUT");
  assertEquals(body.error, "INVALID_INPUT");
  assertEquals(body.legacy_error, "VALIDATION_ERROR");
  assert(Array.isArray(body.fields));
  assertEquals(body.fields[0].key, "a");
});
