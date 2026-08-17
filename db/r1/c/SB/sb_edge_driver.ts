// Boots a real Supabase edge function module in the real Deno runtime on a
// chosen loopback port. Deno.serve is wrapped (not replaced) so the function's
// own handler, imports, env reads and HTTP semantics stay untouched.
//
// Usage: deno run -A sb_edge_driver.ts <abs-path-to-index.ts> <port>
const target = Deno.args[0];
const port = Number(Deno.args[1] ?? 8000);

const orig = Deno.serve.bind(Deno);
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (a: any, b?: any) => {
  const handler = typeof a === 'function' ? a : b;
  const opts = typeof a === 'function' ? {} : (a ?? {});
  return orig({ ...opts, port, hostname: '127.0.0.1', onListen: () => console.log(`EDGE_READY ${port}`) }, handler);
};

await import(target);
