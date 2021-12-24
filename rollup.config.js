import babel from "@rollup/plugin-babel"
import commonJS from "@rollup/plugin-commonjs"
import json from "@rollup/plugin-json"
import nodeResolve from "@rollup/plugin-node-resolve"
import fs from "fs"
import preserveShebang from "rollup-plugin-preserve-shebang"
import { terser } from "rollup-plugin-terser"
import packageConfig from "./package.json"

const { readdir: readDirectory } = fs.promises

/** @typedef {import("rollup").RollupOptions} RollupOptions */

const plugins = [
	babel({
		babelHelpers: "bundled",
		extensions: [ ".ts" ]
	}),
	commonJS(),
	json({ preferConst: true }),
	nodeResolve({ extensions: [ ".ts" ] }),
	preserveShebang()
]

const external = []

if ("dependencies" in packageConfig)
	external.push(...Object.keys(packageConfig.dependencies))

const sourceDirectory = "src"
const findFilesPromise = findFiles(sourceDirectory)

/** @type {(command: Record<string, unknown>) => Promise<RollupOptions>} */
export default async ({ w }) => {
	if (!w) {
		plugins.push(terser({
			ecma: 2019,
			keep_classnames: true,
			keep_fnames: true
		}))
	} else if ("devDependencies" in packageConfig)
		external.push(...Object.keys(packageConfig.devDependencies).map(name => new RegExp(`^${name}(?:/|$)`)))

	return {
		input: Object.fromEntries(
			(await findFilesPromise)
				.filter(path => path.endsWith(".ts") && !path.endsWith(".d.ts"))
				.map(path => [ path.slice(sourceDirectory.length + 1, -3), path ])
		),
		output: {
			dir: "dist",
			interop: "auto"
		},
		plugins,
		external,
		preserveEntrySignatures: "allow-extension",
		treeshake: {
			moduleSideEffects: "no-external"
		}
	}
}

/**
 * @param {string} path the directory to start recursively finding files in
 * @param {string[] | ((name: string) => boolean)} filter either a blacklist or a filter function that returns false to ignore file name
 * @returns {string[]} promise that resolves to array of found files
 */
async function findFiles(path, filter = [], paths = []) {
	const filterFunction = Array.isArray(filter)
		? name => !filter.includes(name)
		: filter

	await Promise.all((await readDirectory(path, { withFileTypes: true })).map(async dirent => {
		if (!filterFunction(dirent.name))
			return

		const direntPath = `${path}/${dirent.name}`

		if (dirent.isDirectory())
			findFiles(direntPath, filterFunction, paths)
		else if (dirent.isFile())
			paths.push(direntPath)
	}))

	return paths
}
