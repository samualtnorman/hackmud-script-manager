#!node_modules/.bin/rollup --config
import babelPresetEnv from "@babel/preset-env"
import babelPresetTypescript from "@babel/preset-typescript"
import { babel } from "@rollup/plugin-babel"
import json from "@rollup/plugin-json"
import { nodeResolve } from "@rollup/plugin-node-resolve"
import terser from "@rollup/plugin-terser"
import { findFiles } from "@samual/lib/findFiles"
import babelPluginHere from "babel-plugin-here"
import { readFile } from "fs/promises"
import { cpus } from "os"

const SOURCE_FOLDER = "src"
const MINIFY = true

/** @type {() => Promise<import("rollup").RollupOptions>} */
export default async () => {
	const [ packageJsonString, foundFiles ] =
		await Promise.all([ readFile("package.json", { encoding: "utf8" }), findFiles(SOURCE_FOLDER) ])

	const packageJson = JSON.parse(packageJsonString)

	const externalDependencies = [
		..."dependencies" in packageJson ? Object.keys(packageJson.dependencies) : [],
		..."optionalDependencies" in packageJson ? Object.keys(packageJson.optionalDependencies) : []
	]

	return {
		input: Object.fromEntries(
			foundFiles.filter(path => path.endsWith(".ts") && !path.endsWith(".d.ts"))
				.map(path => [ path.slice(SOURCE_FOLDER.length + 1, -3), path ])
		),
		output: { dir: "dist", compact: MINIFY, generatedCode: "es2015" },
		plugins: [
			babel({
				babelHelpers: "bundled",
				extensions: [ ".ts" ],
				presets: [
					[ babelPresetEnv, { targets: { node: "20" } } ],
					[ babelPresetTypescript, { allowDeclareFields: true } ]
				],
				plugins: [ babelPluginHere() ]
			}),
			nodeResolve({ extensions: [ ".ts" ] }),
			MINIFY && terser(/** @type {Parameters<typeof terser>[0] & { maxWorkers: number }} */({
				keep_classnames: true,
				keep_fnames: true,
				compress: { passes: Infinity },
				maxWorkers: Math.floor(cpus().length / 2)
			})),
			json({ preferConst: true })
		],
		external: source =>
			externalDependencies.some(dependency => source == dependency || source.startsWith(`${dependency}/`)),
		strictDeprecations: true,
		treeshake: { moduleSideEffects: false }
	}
}
