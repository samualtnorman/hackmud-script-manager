import json from "@rollup/plugin-json"
import typescript from "@rollup/plugin-typescript"
import preserveShebang from "rollup-plugin-preserve-shebang"
import { dependencies } from "./package.json"

export default {
	input: {
		"index": "src/index.ts",
		"bin/hsm": "src/bin/hsm.ts"
	},
	output: {
		dir: ".",
		chunkFileNames: "common.js"
	},
	plugins: [
		json({ preferConst: true }),
		typescript({ tsconfig: "src/tsconfig.json" }),
		preserveShebang()
	],
	external: [
		...Object.keys(dependencies),
		"fs",
		"path",
		"os"
	]
}
