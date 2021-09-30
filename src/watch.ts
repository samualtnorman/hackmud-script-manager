import { watch as watchDirectory } from "chokidar"
import fs from "fs"
import { basename as getBaseName, extname as getFileExtension, resolve as resolvePath } from "path"
import { generateTypings, Info, processScript, supportedExtensions } from "."
import { hackmudLength, writeFilePersist } from "./lib"

const { readFile, readdir: readDirectory } = fs.promises

/**
 * Watches target file or folder for updates and builds and pushes updated file.
 *
 * @param srcDir path to folder containing source files
 * @param hackmudDir path to hackmud directory
 * @param users users to push to (pushes to all if empty)
 * @param scripts scripts to push from (pushes from all if empty)
 * @param onPush function that's called after each script has been built and written
 */
export function watch(srcDir: string, hackmudDir: string, users: string[], scripts: string[], onPush?: (info: Info) => void, { genTypes }: { genTypes?: string | undefined } = {}) {
	const watcher = watchDirectory("", { depth: 1, cwd: srcDir, awaitWriteFinish: { stabilityThreshold: 100 } }).on("change", async path => {
		const extension = getFileExtension(path)

		if (supportedExtensions.includes(extension)) {
			const name = getBaseName(path, extension)
			const fileName = getBaseName(path)

			if (path == fileName) {
				if (!scripts.length || scripts.includes(name)) {
					const sourceCode = await readFile(resolvePath(srcDir, path), { encoding: "utf-8" })
					const skips = new Map<string, string[]>()
					const promisesSkips: Promise<any>[] = []

					for (const dir of await readDirectory(srcDir, { withFileTypes: true })) {
						if (!dir.isDirectory())
							continue

						promisesSkips.push(readDirectory(resolvePath(srcDir, dir.name), { withFileTypes: true }).then(files => {
							for (const file of files) {
								if (!file.isFile())
									continue

								const fileExtension = getFileExtension(file.name)

								if (!supportedExtensions.includes(fileExtension))
									continue

								const name = getBaseName(file.name, fileExtension)
								const skip = skips.get(name)

								if (skip)
									skip.push(dir.name)
								else
									skips.set(name, [ dir.name ])
							}
						}))
					}

					await Promise.all(promisesSkips)

					let error = null

					const { script, srcLength } = await processScript(sourceCode).catch(reason => {
						error = reason

						return {
							script: "",
							srcLength: 0
						}
					})

					const info: Info = {
						file: path,
						users: [],
						minLength: 0,
						error,
						srcLength
					}

					const promises: Promise<any>[] = []

					if (!error) {
						if (script) {
							const skip = skips.get(name) || []

							info.minLength = hackmudLength(script)

							if (!users.length) {
								users = (await readDirectory(hackmudDir, { withFileTypes: true }))
									.filter(a => a.isFile() && getFileExtension(a.name) == ".key")
									.map(a => getBaseName(a.name, ".key"))
							}

							for (const user of users) {
								if (skip.includes(user))
									continue

								info.users.push(user)
								promises.push(writeFilePersist(resolvePath(hackmudDir, user, "scripts", `${name}.js`), script))
							}
						} else
							info.error = new Error("processed script was empty")
					}

					if (onPush) {
						await Promise.all(promises)
						onPush(info)
					}
				}
			} else {
				const user = getBaseName(resolvePath(path, ".."))

				if ((!users.length || users.includes(user)) && (!scripts.length || scripts.includes(name))) {
					const sourceCode = await readFile(resolvePath(srcDir, path), { encoding: "utf-8" })
					let error = null

					const { script, srcLength } = await processScript(sourceCode).catch(reason => {
						error = reason

						return {
							script: "",
							srcLength: 0
						}
					})

					const info: Info = {
						file: path,
						users: [ user ],
						minLength: 0,
						error,
						srcLength
					}

					if (!error) {
						if (script) {
							info.minLength = hackmudLength(script)
							await writeFilePersist(resolvePath(hackmudDir, user, "scripts", `${name}.js`), script)
						} else
							info.error = new Error("processed script was empty")
					}

					onPush?.(info)
				}
			}
		}
	})

	if (genTypes) {
		generateTypings(srcDir, resolvePath(srcDir, genTypes), hackmudDir)
		watcher.on("add", () => generateTypings(srcDir, resolvePath(srcDir, genTypes), hackmudDir))
		watcher.on("unlink", () => generateTypings(srcDir, resolvePath(srcDir, genTypes), hackmudDir))
	}
}

export default watch
