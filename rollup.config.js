import babel from "@rollup/plugin-babel"
import commonJS from "@rollup/plugin-commonjs"
import json from "@rollup/plugin-json"
import nodeResolve from "@rollup/plugin-node-resolve"
import { promises as fsPromises } from "fs"
import preserveShebang from "rollup-plugin-preserve-shebang"
import { terser } from "rollup-plugin-terser"
import packageConfig from "./package.json"

const { readdir: readDirectory } = fsPromises

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
			dir: "dist"
		},
		plugins,
		external,
		preserveEntrySignatures: "allow-extension"
	}
}

/**
 * @param path the directory to start recursively finding files in
 * @param filter either a blacklist or a filter function that returns false to ignore file name
 * @returns promise that resolves to array of found files
 * @type {(path: string, filter?: string[] | ((name: string) => boolean)) => Promise<string[]>}
 */
async function findFiles(path, filter = []) {
	const paths = []
	let /** @type {(name: string) => boolean} */ filterFunction

	if (Array.isArray(filter))
		filterFunction = name => !filter.includes(name)
	else
		filterFunction = filter

	for (const dirent of await readDirectory(path, { withFileTypes: true })) {
		if (!filterFunction(dirent.name))
			continue

		const direntPath = `${path}/${dirent.name}`

		if (dirent.isDirectory())
			await findFilesSub(direntPath, filterFunction, paths)
		else if (dirent.isFile())
			paths.push(direntPath)
	}

	return paths
}

async function findFilesSub(path, filterFunction, paths) {
	const promises = []

	for (const dirent of await readDirectory(path, { withFileTypes: true })) {
		if (!filterFunction(dirent.name))
			continue

		const direntPath = `${path}/${dirent.name}`

		if (dirent.isDirectory())
			promises.push(findFilesSub(direntPath, filterFunction, paths))
		else if (dirent.isFile())
			paths.push(direntPath)
	}

	await Promise.all(promises)
	return paths
}
