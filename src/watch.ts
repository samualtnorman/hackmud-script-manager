import { watch as watchDirectory } from "chokidar"
import fs from "fs"
import { basename as getBaseName, extname as getFileExtension, resolve as resolvePath } from "path"
import { Info } from "."
import { supportedExtensions } from "./constants.json"
import generateTypings from "./generateTypings"
import processScript from "./processScript"

const { readFile, readdir: readDirectory } = fs.promises

/**
 * Watches target file or folder for updates and builds and pushes updated file.
 *
 * @param sourceDirectory path to folder containing source files
 * @param hackmudDirectory path to hackmud directory
 * @param users to push to (pushes to all if empty)
 * @param scripts to push from (pushes from all if empty)
 * @param onPush function that's called on each script push
 */
export function watch(sourceDirectory: string, hackmudDirectory: string, users: string[], scripts: string[], onPush?: (info: Info) => void, { genTypes }: { genTypes?: string | undefined } = {}) {
	const watcher = watchDirectory(``, { depth: 1, cwd: sourceDirectory, awaitWriteFinish: { stabilityThreshold: 100 } }).on(`change`, async path => {
		const extension = getFileExtension(path)

		if (supportedExtensions.includes(extension)) {
			const name = getBaseName(path, extension)
			const fileName = getBaseName(path)

			if (path == fileName) {
				if (!scripts.length || scripts.includes(name)) {
					const sourceCode = await readFile(resolvePath(sourceDirectory, path), { encoding: `utf-8` })
					const skips = new Map<string, string[]>()
					const promisesSkips: Promise<any>[] = []

					for (const dirent of await readDirectory(sourceDirectory, { withFileTypes: true })) {
						if (!dirent.isDirectory())
							continue

						promisesSkips.push(readDirectory(resolvePath(sourceDirectory, dirent.name), { withFileTypes: true }).then(files => {
							for (const file of files) {
								if (!file.isFile())
									continue

								const fileExtension = getFileExtension(file.name)

								if (!supportedExtensions.includes(fileExtension))
									continue

								const name = getBaseName(file.name, fileExtension)
								const skip = skips.get(name)

								if (skip)
									skip.push(dirent.name)
								else
									skips.set(name, [ dirent.name ])
							}
						}))
					}

					await Promise.all(promisesSkips)

					let error = null

					const { srcLength } = await processScript(sourceCode).catch(error_ => {
						error = error_

						return {
							script: ``,
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

					// if (!error) {
					// 	if (script) {
					// 		const skip = skips.get(name) || []

					// 		info.minLength = countHackmudCharacters(script)

					// 		if (!users.length) {
					// 			// eslint-disable-next-line require-atomic-updates
					// 			users = (await readDirectory(hackmudDir, { withFileTypes: true }))
					// 				.filter(dirent => dirent.isFile() && getFileExtension(dirent.name) == `.key`)
					// 				.map(dirent => getBaseName(dirent.name, `.key`))
					// 		}

					// 		for (const user of users) {
					// 			if (skip.includes(user))
					// 				continue

					// 			info.users.push(user)
					// 			promises.push(writeFilePersistent(resolvePath(hackmudDir, user, `scripts`, `${name}.js`), script))
					// 		}
					// 	} else
					// 		info.error = new Error(`processed script was empty`)
					// }

					if (onPush) {
						await Promise.all(promises)
						onPush(info)
					}
				}
			} else {
				const user = getBaseName(resolvePath(path, `..`))

				if ((!users.length || users.includes(user)) && (!scripts.length || scripts.includes(name))) {
					const sourceCode = await readFile(resolvePath(sourceDirectory, path), { encoding: `utf-8` })
					let error = null

					const { srcLength } = await processScript(sourceCode).catch(error_ => {
						error = error_

						return {
							script: ``,
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

					// if (!error) {
					// 	if (script) {
					// 		info.minLength = countHackmudCharacters(script)
					// 		await writeFilePersistent(resolvePath(hackmudDir, user, `scripts`, `${name}.js`), script)
					// 	} else
					// 		info.error = new Error(`processed script was empty`)
					// }

					onPush?.(info)
				}
			}
		}
	})

	if (genTypes) {
		generateTypings(sourceDirectory, resolvePath(sourceDirectory, genTypes), hackmudDirectory)
		watcher.on(`add`, () => generateTypings(sourceDirectory, resolvePath(sourceDirectory, genTypes), hackmudDirectory))
		watcher.on(`unlink`, () => generateTypings(sourceDirectory, resolvePath(sourceDirectory, genTypes), hackmudDirectory))
	}
}

export default watch
