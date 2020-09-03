import { readdir as readDir, writeFile, unlink, mkdir as mkDir, readFile, copyFile } from "fs/promises"
import { watch as watchDir } from "chokidar"
import { minify } from "terser"
import { resolve as resolvePath, basename, extname } from "path"

/**
 * Copies target file or files in target folder to hackmud folder.
 * 
 * @param target file or folder to be pushed
 * @param hackmudPath hackmud directory
 * @param user hackmud user to target
 */
export async function pushBuilt(target: string, hackmudPath: string, user: string) {
	if (extname(target) == ".js") {
		try {
			copyFile(target, resolvePath(hackmudPath, user, "scripts", basename(target)))

			return { pushedCount: 1 }
		} catch (error) {
			if (error.code != "EISDIR")
				throw error
		}
	}

	const files = await readDir(target)
	let pushedCount = 0

	for (const file of files)
		if (extname(file) == ".js") {
			copyFile(resolvePath(target, file), resolvePath(hackmudPath, user, "scripts", file))
			pushedCount++
		}

	return { pushedCount }
}

/**
 * Deletes target file or files in target folder and equivalent in hackmud folder.
 * 
 * @param target file or folder to be cleared
 * @param hackmudPath hackmud directory
 * @param user hackmud user to target 
 */
export async function clear(target: string, hackmudPath: string, user: string) {
	let targetRemoved = 0
	let pushedRemoved = 0

	for (const file of await readDir(target))
		if (extname(file) == ".js") {
			unlink(resolvePath(target, file))
			targetRemoved++
		}

	for (const file of await readDir(resolvePath(hackmudPath, user, "scripts")))
		if (extname(file) == ".js") {
			unlink(resolvePath(hackmudPath, user, "scripts", file))
			pushedRemoved++
		}

	return { targetRemoved, pushedRemoved }
}

/**
 * Builds target file or files in target folder and dumps them in specified directory.
 * 
 * @param target file or folder to be built
 * @param distPath folder to dump built files
 */
export async function build(target: string, distPath: string) {
	const filesWrote: { name: string, minLength: number, oldLength: number }[] = []

	for (const name of await readDir(target)) {
		const code = await readFile(resolvePath(target, name), { encoding: "utf8" })
		const minCode = await hackmudMinify(code)

		try {
			writeFile(resolvePath(distPath, name), addAutocomplete(code, minCode))
		} catch (error) {
			if (error.code != "ENOENT")
				throw error

			mkDir(distPath)
			writeFile(resolvePath(distPath, name), addAutocomplete(code, minCode))
		}

		filesWrote.push({ name, minLength: hackmudLength(minCode), oldLength: hackmudLength(code) })
	}

	return filesWrote
}

/**
 * Watches target file or folder for updates and builds and pushes updated file.
 * 
 * @param srcPath path to folder containing source files
 * @param hackmudPath path to hackmud directory
 * @param users users to push to (pushes to all if empty)
 * @param scripts scripts to push from (pushes from all if empty)
 * @param onUpdate function that's called after each script has been built and written
 */
export function watch(srcPath: string, hackmudPath: string, users: string[], scripts: string[], onUpdate?: (info: Info) => void) {
	watchDir("", { depth: 1, cwd: srcPath, awaitWriteFinish: { stabilityThreshold: 100 } }).on("change", async path => {
		if (extname(path) == ".js") {
			const script = basename(path, ".js")
			const parts = path.split("/")

			switch (parts.length) {
				case 1: {
					const file = path

					if (!scripts.length || scripts.includes(script)) {
						const code = await readFile(resolvePath(srcPath, path), { encoding: "utf-8" })

						const skips = new Map<string, string[]>()
						const promisesSkips: Promise<any>[] = []
				
						for (const dir of await readDir(srcPath, { withFileTypes: true })) {
							if (dir.isDirectory()) {
								promisesSkips.push(readDir(resolvePath(srcPath, dir.name), { withFileTypes: true }).then(files => {
									for (const file of files) {
										if (file.isFile() && extname(file.name) == ".js") {
											const name = basename(file.name, ".js")
											const skip = skips.get(name)
				
											if (skip)
												skip.push(dir.name)
											else
												skips.set(name, [ dir.name ])
										}
									}
								}))
							}
						}

						await Promise.all(promisesSkips)
						
						const minCode = await hackmudMinify(code)
						const info: Info = { script: path, users: [], srcLength: hackmudLength(code), minLength: hackmudLength(minCode) }

						const skip = skips.get(script) || []
						const promises: Promise<any>[] = []

						if (!users.length)
							users = (await readDir(hackmudPath, { withFileTypes: true }))
								.filter(a => a.isFile() && extname(a.name) == ".key")
								.map(a => basename(a.name, ".key"))
						
						for (const user of users) {
							if (!skip.includes(user)) {
								info.users.push(user)

								promises.push(writeFile(resolvePath(hackmudPath, user, "scripts", file), minCode).catch(async error => {
									if (error.code != "ENOENT")
										throw error
									
									await mkDir(resolvePath(hackmudPath, user, "scripts"), { recursive: true })
									await writeFile(resolvePath(hackmudPath, user, "scripts", file), minCode)
								}))
							}
						}

						if (onUpdate) {
							await Promise.all(promises)
							onUpdate(info)
						}
					}

					break
				}

				case 2: {
					const [ user, file ] = parts

					if ((!users.length || users.includes(user)) && (!scripts.length || scripts.includes(script))) {
						const code = await readFile(resolvePath(srcPath, path), { encoding: "utf-8" })
						const minCode = await hackmudMinify(code)
						const info: Info = { script: path, users: [ user ], srcLength: hackmudLength(code), minLength: hackmudLength(minCode) }
						const promises: Promise<any>[] = []

						promises.push(writeFile(resolvePath(hackmudPath, user, "scripts", file), minCode).catch(async error => {
							if (error.code != "ENOENT")
								throw error
							
							await mkDir(resolvePath(hackmudPath, user, "scripts"), { recursive: true })
							await writeFile(resolvePath(hackmudPath, user, "scripts", file), minCode)
						}))

						if (onUpdate) {
							await Promise.all(promises)
							onUpdate(info)
						}
					}

					break
				}
			}
		}
	})
}

interface Info {
	script: string
	users: string[]
	srcLength: number
	minLength: number
}

/**
 * Push a specific or all scripts to a specific or all users.
 * In source directory, scripts in folders will override scripts with same name for user with folder name.
 * 
 * e.g. foo/bar.js overrides other bar.js script just for user foo.
 * 
 * @param srcPath path to folder containing source files
 * @param hackmudPath path to hackmud directory
 * @param users users to push to (pushes to all if empty)
 * @param scripts scripts to push from (pushes from all if empty)
 * @param callback function that's called after each script has been built and written
 */
export function push(srcPath: string, hackmudPath: string, users: string[], scripts: string[], callback?: (info: Info) => void) {
	return new Promise<Info[]>(async resolve => {
		const infoAll: Info[] = []
		const files = await readDir(srcPath, { withFileTypes: true })
		const skips = new Map<string, string[]>()

		const promises: Promise<any>[] = []

		for (const dir of files) {
			const user = dir.name

			if (dir.isDirectory() && (!users.length || users.includes(user))) {
				promises.push(readDir(resolvePath(srcPath, user), { withFileTypes: true }).then(files => {
					for (const file of files) {
						const script = file.name
						const name = basename(script, ".js")

						if (extname(script) == ".js" && file.isFile() && (!scripts.length || scripts.includes(name))) {
							let skip = skips.get(name)

							if (skip)
								skip.push(user)
							else
								skips.set(name, [ user ])

							readFile(resolvePath(srcPath, user, script), { encoding: "utf-8" }).then(async code => {
								const minCode = await hackmudMinify(code)
								const info: Info = { script: `${user}/${script}`, users: [ user ], srcLength: hackmudLength(code), minLength: hackmudLength(minCode) }
		
								infoAll.push(info)
		
								await writeFile(resolvePath(hackmudPath, user, "scripts", script), minCode).catch(async error => {
									if (error.code != "ENOENT")
										throw error
									
									await mkDir(resolvePath(hackmudPath, user, "scripts"), { recursive: true })
									await writeFile(resolvePath(hackmudPath, user, "scripts", script), minCode)
								})
		
								callback?.(info)
							})
						}
					}
				}))
			}
		}
	
		if (!users.length)
			users = (await readDir(hackmudPath, { withFileTypes: true }))
				.filter(a => a.isFile() && extname(a.name) == ".key")
				.map(a => basename(a.name, ".key"))

		Promise.all(promises).then(() => {
			const promises: Promise<any>[] = []

			for (const file of files) {
				if (file.isFile()) {
					const extension = extname(file.name)
	
					if (extension == ".js") {
						const name = basename(file.name, extension)
	
						if (!scripts.length || scripts.includes(name)) {
							promises.push(readFile(resolvePath(srcPath, file.name), { encoding: "utf-8" }).then(async code => {
								const minCode = await hackmudMinify(code)
								const info: Info = { script: file.name, users: [], srcLength: hackmudLength(code), minLength: hackmudLength(minCode) }
								
								infoAll.push(info)

								const skip = skips.get(name) || []

								const promises: Promise<any>[] = []
	
								for (const user of users)
									if (!skip.includes(user)) {
										info.users.push(user)
	
										promises.push(writeFile(resolvePath(hackmudPath, user, "scripts", file.name), minCode).catch(async error => {
											if (error.code != "ENOENT")
												throw error
											
											await mkDir(resolvePath(hackmudPath, user, "scripts"), { recursive: true })
											await writeFile(resolvePath(hackmudPath, user, "scripts", file.name), minCode)
										}))
									}

								if (callback) {
									await Promise.all(promises)
									callback(info)
								}
							}))
						}
					}
				}
			}

			Promise.all(promises).then(() => {
				resolve(infoAll)
			})
		})
	})
}

/**
 * Copies script from hackmud to local source folder.
 * 
 * @param srcPath path to folder containing source files
 * @param hackmudPath path to hackmud directory
 * @param scriptName script to pull in `user.script` format
 */
export async function pull(srcPath: string, hackmudPath: string, scriptName: string) {
	const [ user, script ] = scriptName.split(".")

	try {
		await copyFile(resolvePath(hackmudPath, user, "scripts", `${script}.js`), resolvePath(srcPath, user, `${script}.js`))
	} catch (error) {
		if (error.code != "ENOENT")
			throw error

		await mkDir(resolvePath(srcPath, user))
		await copyFile(resolvePath(hackmudPath, user, "scripts", `${script}.js`), resolvePath(srcPath, user, `${script}.js`))
	}
}

async function hackmudMinify(code: string) {
	const anon_code = Date.now().toString(16)

	const minifiedCode = (await minify(
		code.replace(/function(?: \w+| )?\(/, `function script_${anon_code}(`)
			.replace(/#(?:(?:f|h|m|l|n|[0-4])?s|db|G|FMCL)/g, a => a.replace("#", `_hash_${anon_code}_`)),
			{
				compress: {
					arrows: false, // hackmud does not like this
					keep_fargs: false,
					negate_iife: false,
					booleans_as_integers: true,
					unsafe_undefined: true,
					unsafe_comps: true,
					unsafe_proto: true,
					passes: 2,
					ecma: 2017
				}
			}
	)).code

	if (minifiedCode)
		return minifiedCode
			.replace(`script_${anon_code}`, "")
			.replace(new RegExp(`_hash_${anon_code}_`, "g"), "#")
	else
		return ""
}

function addAutocomplete(sourceCode: string, code: string) {
	const autocompleteRegex = /^(?:\/\/ @autocomplete (.+)|function(?: \w+| )?\([^\)]*\)\s*{\s*\/\/(.+))\n/
	const match = sourceCode.match(autocompleteRegex)

	if (!match)
		return code
		
	const autocomplete = (match[1] || match[2]).trim()
	return code.replace(/function\s*\([^\)]*\){/, `$& // ${autocomplete}\n`)
}

function hackmudLength(code: string) {
	return code.replace(/\s/g, "").length
}
