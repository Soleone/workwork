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
  // A copy of the lean skill, kept byte-for-byte so it diffs cleanly against the original.
  fmt: { ignorePatterns: ["prompts/**"] },
});
