import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/cli.ts"],
    dts: false,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  // The lean skill copy is kept byte-for-byte so it diffs cleanly against the original, and
  // release-it writes the changelog in its own style.
  fmt: { ignorePatterns: ["prompts/**", "CHANGELOG.md"] },
});
