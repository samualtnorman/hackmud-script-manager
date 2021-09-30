import fs from "fs"
import { basename as getBaseName, extname as getFileExtension, resolve as resolvePath } from "path"
import { Info, processScript, supportedExtensions } from "."
import { hackmudLength, writeFilePersist } from "./lib"

const { readFile, readdir: readDirectory } = fs.promises

/**
 * Push a specific or all scripts to a specific or all users.
 * In source directory, scripts in folders will override scripts with same name for user with folder name.
 *
 * e.g. foo/bar.js overrides other bar.js script just for user foo.
 *
 * @param srcDir path to folder containing source files
 * @param hackmudDir path to hackmud directory
 * @param users users to push to (pushes to all if empty)
 * @param scripts scripts to push from (pushes from all if empty)
 * @param onPush function that's called when a script has been pushed
 */
export function push(srcDir: string, hackmudDir: string, users: string[], scripts: string[], onPush?: (info: Info) => void) {
	return new Promise<Info[]>(async resolve => {
		const infoAll: Info[] = []
		const files = await readDirectory(srcDir, { withFileTypes: true })
		const skips = new Map<string, string[]>()
		const promises: Promise<any>[] = []

		for (const dir of files) {
			const user = dir.name

			if (dir.isDirectory() && (!users.length || users.includes(user))) {
				promises.push(readDirectory(resolvePath(srcDir, user), { withFileTypes: true }).then(files => {
					for (const file of files) {
						const extension = getFileExtension(file.name)
						const name = getBaseName(file.name, extension)

						if (supportedExtensions.includes(extension) && file.isFile() && (!scripts.length || scripts.includes(name))) {
							let skip = skips.get(name)

							if (skip)
								skip.push(user)
							else
								skips.set(name, [ user ])

							readFile(resolvePath(srcDir, user, file.name), { encoding: "utf-8" }).then(async code => {
								let error = null

								const { srcLength, script: minCode } = await processScript(code).catch(reason => {
									error = reason

									return {
										srcLength: 0,
										script: ""
									}
								})

								const info: Info = {
									file: `${user}/${file.name}`,
									users: [ user ],
									minLength: 0,
									error,
									srcLength
								}

								infoAll.push(info)

								if (!error) {
									if (minCode) {
										info.minLength = hackmudLength(minCode)
										await writeFilePersist(resolvePath(hackmudDir, user, "scripts", `${name}.js`), minCode)
									} else
										info.error = new Error("processed script was empty")
								}

								onPush?.(info)
							})
						}
					}
				}))
			}
		}

		if (!users.length) {
			users = (await readDirectory(hackmudDir, { withFileTypes: true }))
				.filter(a => a.isFile() && getFileExtension(a.name) == ".key")
				.map(a => getBaseName(a.name, ".key"))
		}

		Promise.all(promises).then(() => {
			const promises: Promise<any>[] = []

			for (const file of files) {
				if (file.isFile()) {
					const extension = getFileExtension(file.name)

					if (supportedExtensions.includes(extension)) {
						const name = getBaseName(file.name, extension)

						if (!scripts.length || scripts.includes(name)) {
							promises.push(readFile(resolvePath(srcDir, file.name), { encoding: "utf-8" }).then(async code => {
								let error = null

								const { script: minCode, srcLength } = await processScript(code).catch(reason => {
									error = reason

									return {
										script: "",
										srcLength: 0
									}
								})

								const info: Info = {
									file: file.name,
									users: [],
									minLength: 0,
									error,
									srcLength
								}

								infoAll.push(info)

								if (!error) {
									if (minCode) {
										info.minLength = hackmudLength(minCode)
										const skip = skips.get(name) || []
										const promises: Promise<any>[] = []

										for (const user of users) {
											if (!skip.includes(user)) {
												info.users.push(user)
												promises.push(writeFilePersist(resolvePath(hackmudDir, user, "scripts", `${name}.js`), minCode))
											}
										}
									} else
										info.error = new Error("processed script was empty")
								}

								if (onPush)
									Promise.all(promises).then(() => onPush(info))
							}))
						}
					}
				}
			}

			Promise.all(promises).then(() => resolve(infoAll))
		})
	})
}

export default push
