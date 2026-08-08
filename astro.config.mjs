import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

// IMPORTANT: `base` must match the "mountPath" you choose in webflow.json.
// If your app is mounted at https://your-site.com/agents, keep "/agents".
export default defineConfig({
  base: "/agents",
  output: "server",
  adapter: cloudflare({
    platformProxy: { enabled: true }, // lets `wrangler dev` expose KV locally
  }),
});
