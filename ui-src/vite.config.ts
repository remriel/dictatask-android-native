import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

const outputDirectory = fileURLToPath(new URL("../app/src/main/assets", import.meta.url));
const taskEntrypoint = fileURLToPath(new URL("./index.html", import.meta.url));
const vaultEntrypoint = fileURLToPath(new URL("./vault.html", import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: outputDirectory,
    emptyOutDir: true,
    cssCodeSplit: false,
    target: "chrome105",
    rollupOptions: {
      input: {
        tasks: taskEntrypoint,
        vault: vaultEntrypoint,
      },
    },
  },
});
