import type { ViteUserConfig } from "vitest/config"
// @ts-expect-error it does exist, it just doesn't have typings
import babelPluginSyntaxTypescript from "@babel/plugin-syntax-typescript"
import { babel } from "@rollup/plugin-babel"
import { babelPluginHere } from "babel-plugin-here"

export default {
	test: { includeSource: [ `src/**/*.ts` ] },
	plugins: [
		{
			...babel({
				babelHelpers: `bundled`,
				extensions: [ `.ts` ],
				plugins: [ babelPluginSyntaxTypescript, babelPluginHere() ]
			}) as any,
			enforce: `pre`
		}
	]
} satisfies ViteUserConfig
