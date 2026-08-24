import { cloudflare } from "@cloudflare/vite-plugin";
import { sites } from "@openai/sites-vite-plugin";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json" with { type: "json" };

const PLACEHOLDER_DATABASE_ID = "00000000-0000-4000-8000-000000000000";

export default defineConfig({
    plugins: [
        sites(),
        cloudflare({
            viteEnvironment: { name: "server" },
            config: {
                main: "worker.js",
                compatibility_flags: ["nodejs_compat"],
                d1_databases: hostingConfig.d1
                    ? [
                          {
                              binding: hostingConfig.d1,
                              database_name: "my-ai-db",
                              database_id: PLACEHOLDER_DATABASE_ID
                          }
                      ]
                    : []
            }
        })
    ]
});
