import type { ViteUserConfig } from "vitest/config"
import { babel } from "@rollup/plugin-babel"
import { babelPluginHere } from "babel-plugin-here"

export default {
	test: { includeSource: [ `src/**/*.ts` ] },
	plugins: [ babel({ babelHelpers: `bundled`, extensions: [ `.ts` ], plugins: [ babelPluginHere() ] }) as any ]
} satisfies ViteUserConfig
