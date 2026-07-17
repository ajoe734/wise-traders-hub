import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listExpertsTool from "./tools/list_experts";
import listMyHoldingsTool from "./tools/list_my_holdings";

// Build the OAuth issuer from the Supabase project ref only. VITE_SUPABASE_URL
// may be the Lovable Cloud `.lovable.cloud` proxy, but mcp-js requires the
// direct `<ref>.supabase.co` issuer that discovery advertises.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "legendflow-mcp",
  title: "Legendflow",
  version: "0.1.0",
  instructions:
    "Tools for Legendflow (台灣選股/訂閱平台). Use `whoami` to confirm identity, `list_experts` to browse published mentors and advisors, and `list_my_holdings` to read the signed-in user's own trade records.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoamiTool, listExpertsTool, listMyHoldingsTool],
});
