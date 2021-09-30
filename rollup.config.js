import json from "@rollup/plugin-json"
import typescript from "@rollup/plugin-typescript"
import preserveShebang from "rollup-plugin-preserve-shebang"
import { dependencies } from "./package.json"
import { promises as fsPromises } from "fs"

const { readdir: readDirectory } = fsPromises

const sourceDirectory = "src"

export default async () => {
	return {
		input: Object.fromEntries((await findFiles(sourceDirectory)).filter(path => path.endsWith(".ts")).map(path => [ path.slice(sourceDirectory.length + 1, -3), path ])),
		output: {
			dir: "."
		},
		plugins: [
			json({ preferConst: true }),
			typescript({ tsconfig: `${sourceDirectory}/tsconfig.json` }),
			preserveShebang()
		],
		external: [
			...Object.keys(dependencies),
			"fs",
			"path",
			"os"
		]
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
