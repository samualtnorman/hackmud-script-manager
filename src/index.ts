import { readdir as readDir, writeFile, mkdir as mkDir, readFile, copyFile, stat } from "fs/promises"
import { watch as watchDir } from "chokidar"
import { minify } from "terser"
import { resolve as resolvePath, basename, extname } from "path"
import { transpileModule, ScriptTarget } from "typescript"

interface Info {
	file: string
	users: string[]
	srcLength: number
	minLength: number
	error: any
}

const supportedExtensions = [ ".js", ".ts" ]

// TODO `clean()` function that delete all scripts in hackmud directory #70
// TODO optional argument (defaults to false) for `clean()` that makes it only remove scripts without a source file #70

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
		const files = await readDir(srcDir, { withFileTypes: true })
		const skips = new Map<string, string[]>()
		const promises: Promise<any>[] = []

		for (const dir of files) {
			const user = dir.name

			if (dir.isDirectory() && (!users.length || users.includes(user))) {
				promises.push(readDir(resolvePath(srcDir, user), { withFileTypes: true }).then(files => {
					for (const file of files) {
						const extension = extname(file.name)
						const name = basename(file.name, extension)

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

		if (!users.length)
			users = (await readDir(hackmudDir, { withFileTypes: true }))
				.filter(a => a.isFile() && extname(a.name) == ".key")
				.map(a => basename(a.name, ".key"))

		Promise.all(promises).then(() => {
			const promises: Promise<any>[] = []

			for (const file of files) {
				if (file.isFile()) {
					const extension = extname(file.name)

					if (supportedExtensions.includes(extension)) {
						const name = basename(file.name, extension)

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

										for (const user of users)
											if (!skip.includes(user)) {
												info.users.push(user)
												promises.push(writeFilePersist(resolvePath(hackmudDir, user, "scripts", `${name}.js`), minCode))
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

/**
 * Watches target file or folder for updates and builds and pushes updated file.
 *
 * @param srcDir path to folder containing source files
 * @param hackmudDir path to hackmud directory
 * @param users users to push to (pushes to all if empty)
 * @param scripts scripts to push from (pushes from all if empty)
 * @param onPush function that's called after each script has been built and written
 */
export function watch(srcDir: string, hackmudDir: string, users: string[], scripts: string[], onPush?: (info: Info) => void, { genTypes }: { genTypes?: string } = {}) {
	const watcher = watchDir("", { depth: 1, cwd: srcDir, awaitWriteFinish: { stabilityThreshold: 100 } }).on("change", async path => {
		const extension = extname(path)

		if (supportedExtensions.includes(extension)) {
			const name = basename(path, extension)
			const fileName = basename(path)

			if (path == fileName) {
				if (!scripts.length || scripts.includes(name)) {
					const code = await readFile(resolvePath(srcDir, path), { encoding: "utf-8" })
					const skips = new Map<string, string[]>()
					const promisesSkips: Promise<any>[] = []

					for (const dir of await readDir(srcDir, { withFileTypes: true }))
						if (dir.isDirectory())
							promisesSkips.push(readDir(resolvePath(srcDir, dir.name), { withFileTypes: true }).then(files => {
								for (const file of files) {
									if (file.isFile()) {
										const ext = extname(file.name)

										if (supportedExtensions.includes(ext)) {
											const name = basename(file.name, ext)
											const skip = skips.get(name)

											if (skip)
												skip.push(dir.name)
											else
												skips.set(name, [ dir.name ])
										}
									}
								}
							}))

					await Promise.all(promisesSkips)

					let error = null

					const { script: minCode, srcLength } = await processScript(code).catch(reason => {
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
						if (minCode) {
							const skip = skips.get(name) || []

							info.minLength = hackmudLength(minCode)

							if (!users.length)
								users = (await readDir(hackmudDir, { withFileTypes: true }))
									.filter(a => a.isFile() && extname(a.name) == ".key")
									.map(a => basename(a.name, ".key"))

							for (const user of users)
								if (!skip.includes(user)) {
									info.users.push(user)
									promises.push(writeFilePersist(resolvePath(hackmudDir, user, "scripts", `${name}.js`), minCode))
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
				const user = basename(resolvePath(path, ".."))

				if ((!users.length || users.includes(user)) && (!scripts.length || scripts.includes(name))) {
					const code = await readFile(resolvePath(srcDir, path), { encoding: "utf-8" })

					let error = null

					const { script: minCode, srcLength } = await processScript(code).catch(reason => {
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

					if (!error)
						if (minCode) {
							info.minLength = hackmudLength(minCode)
							await writeFilePersist(resolvePath(hackmudDir, user, "scripts", `${name}.js`), minCode)
						} else
							info.error = new Error("processed script was empty")

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

/**
 * Copies script from hackmud to local source folder.
 *
 * @param srcPath path to folder containing source files
 * @param hackmudPath path to hackmud directory
 * @param script script to pull in `user.name` format
 */
export async function pull(srcPath: string, hackmudPath: string, script: string) {
	const [ user, name ] = script.split(".")
	await copyFilePersist(resolvePath(hackmudPath, user, "scripts", `${name}.js`), resolvePath(srcPath, user, `${name}.js`))
}

export async function syncMacros(hackmudPath: string) {
	const files = await readDir(hackmudPath, { withFileTypes: true })
	const macros = new Map<string, { macro: string, date: Date }>()
	const users: string[] = []

	for (const file of files) {
		if (file.isFile())
			switch (extname(file.name)) {
				case ".macros": {
					const lines = (await readFile(resolvePath(hackmudPath, file.name), { encoding: "utf-8" })).split("\n")
					const date = (await stat(resolvePath(hackmudPath, file.name))).mtime

					for (let i = 0; i < lines.length / 2 - 1; i++) {
						const macroName = lines[i * 2]
						const curMacro = macros.get(macroName)

						if (!curMacro || date > curMacro.date)
							macros.set(macroName, { date, macro: lines[i * 2 + 1] })
					}

					break
				}

				case ".key": {
					users.push(basename(file.name, ".key"))
					break
				}
			}
	}

	let macroFile = ""
	let macrosSynced = 0

	for (const [ name, { macro } ] of [ ...macros ].sort(([ a ], [ b ]) => (a as any > b as any) - (a as any < b as any)))
		if (macro[0] == macro[0].toLowerCase()) {
			macroFile += `${name}\n${macro}\n`
			macrosSynced++
		}

	for (const user of users)
		writeFile(resolvePath(hackmudPath, user + ".macros"), macroFile)

	return { macrosSynced, usersSynced: users.length }
}

export async function test(srcPath: string) {
	const promises: Promise<any>[] = []

	const errors: {
		file: string
		message: string
		line: number
	}[] = []

	for (const dirent of await readDir(srcPath, { withFileTypes: true })) {
		if (dirent.isDirectory()) {
			promises.push(readDir(resolvePath(srcPath, dirent.name), { withFileTypes: true }).then(files => {
				const promises: Promise<any>[] = []

				for (const file of files) {
					if (file.isFile() && supportedExtensions.includes(extname(file.name))) {
						promises.push(readFile(resolvePath(srcPath, dirent.name, file.name), { encoding: "utf-8" }).then(code =>
							processScript(code).then(({ warnings }) =>
								errors.push(...warnings.map(({ message, line }) => ({
									file: `${dirent.name}/${file.name}`,
									message, line
								})))
							)
						))
					}
				}

				return Promise.all(promises)
			}))
		} else if (dirent.isFile() && supportedExtensions.includes(extname(dirent.name))) {
			promises.push(readFile(resolvePath(srcPath, dirent.name), { encoding: "utf-8" }).then(code =>
				processScript(code).then(({ warnings }) =>
					errors.push(...warnings.map(({ message, line }) => ({
						file: dirent.name,
						message, line
					})))
				)
			))
		}
	}

	await Promise.all(promises)

	return errors
}

export async function generateTypings(srcDir: string, target: string, hackmudPath?: string) {
	const users = new Set<string>()

	if (hackmudPath) {
		for (const dirent of await readDir(hackmudPath, { withFileTypes: true })) {
			if (dirent.isFile() && extname(dirent.name) == ".key")
				users.add(basename(dirent.name, ".key"))
		}
	}

	const wildScripts: string[] = []
	const wildAnyScripts: string[] = []
	const allScripts: Record<string, string[]> = {}
	const allAnyScripts: Record<string, string[]> = {}

	for (const dirent of await readDir(srcDir, { withFileTypes: true })) {
		if (dirent.isFile()) {
			if (extname(dirent.name) == ".ts")
				wildScripts.push(basename(dirent.name, ".ts"))
			else if (extname(dirent.name) == ".js")
				wildAnyScripts.push(basename(dirent.name, ".js"))
		} else if (dirent.isDirectory()) {
			const scripts: string[] = allScripts[dirent.name] = []
			const anyScripts: string[] = allAnyScripts[dirent.name] = []

			users.add(dirent.name)

			for (const file of await readDir(resolvePath(srcDir, dirent.name), { withFileTypes: true })) {
				if (file.isFile()) {
					if (extname(file.name) == ".ts")
						scripts.push(basename(file.name, ".ts"))
					else if (extname(file.name) == ".js")
						anyScripts.push(basename(file.name, ".js"))
				}
			}
		}
	}

	let o = ""

	for (const script of wildScripts)
		o += `import { script as $${script}$ } from "./src/${script}"\n`

	o += "\n"

	for (const user in allScripts) {
		const scripts = allScripts[user]

		for (const script of scripts)
			o += `import { script as $${user}$${script}$ } from "./src/${user}/${script}"\n`
	}

	// TODO detect security level and generate apropriate code

	// TODO accurate function signatures
	// currently I lose the generic-ness of my functions when I wrap them
	// just regexing isn't enough and it looks like I'm going to need to parse the files in TypeScript to extract the signature

	o += `
type ArrayRemoveFirst<A> = A extends [ infer FirstItem, ...infer Rest ] ? Rest : never

type Subscript<T extends (...args: any) => any> =
	(...args: ArrayRemoveFirst<Parameters<T>>) => ReturnType<T> | ScriptFailure

type WildFullsec = Record<string, () => ScriptFailure> & {
`

	for (const script of wildScripts)
		o += `\t${script}: Subscript<typeof $${script}$>\n`

	for (const script of wildAnyScripts)
		o += `\t${script}: (...args: any) => any\n`

	o += "}\n\ndeclare global {\n\tinterface PlayerFullsec {"

	let lastWasMultiLine = true

	for (const user of users) {
		const scripts = allScripts[user]
		const anyScripts = allAnyScripts[user]

		if ((scripts && scripts.length) || (anyScripts  && anyScripts.length)) {
			lastWasMultiLine = true

			o += `\n\t\t${user}: WildFullsec & {\n`

			for (const script of scripts)
				o += `\t\t\t${script}: Subscript<typeof $${user}$${script}$>\n`

			for (const script of anyScripts)
				o += `\t\t\t${script}: (...args: any) => any\n`

			o += "\t\t}"
		} else {
			if (lastWasMultiLine) {
				o += "\n"
				lastWasMultiLine = false
			}

			o += `\t\t${user}: WildFullsec`
		}

		o += "\n"
	}

	o += "\t}\n}\n"

	await writeFile(target, o)
}

/**
 * Minifies a given script
 *
 * @param script JavaScript or TypeScript code
 */
export async function processScript(script: string) {
	const autocompleteMatch = script.match(/^(?:\/\/ @autocomplete (.+)|function(?: \w+| )?\([^\)]*\)\s*{\s*\/\/(.+))\n/)

	script = script
		.replace(/[#\$]([\w.]+\()/g, a => "$" + a.slice(1).replace(/\./g, "$"))
		.replace(/function\s*\(/, "function script(")
		.replace(/#G[^\w]/g, "$G")

	// compilation
	const { outputText, diagnostics = [] } = transpileModule(script, {
		compilerOptions: {
			target: ScriptTarget.ES2015,
			removeComments: true
		},
		reportDiagnostics: true
	})

	const warnings = diagnostics.map(({ messageText, start }) => ({
		message: typeof messageText == "string" ? messageText : messageText.messageText,
		line: positionToLineNumber(start!, script)
	}))

	script = outputText.replace(/^export /, "")

	const transpiledSource = script.replace(/^function ?\w+\(/, "function (")
	const srcLength = hackmudLength(transpiledSource)

	// minification
	script = (await minify(script, {
		ecma: 2015,
		compress: {
			booleans_as_integers: true,
			passes: Infinity,
			unsafe: true,
			unsafe_arrows: true,
			unsafe_comps: true,
			unsafe_symbols: true,
			unsafe_methods: true,
			unsafe_proto: true,
			unsafe_regexp: true,
			unsafe_undefined: true
		},
		format: {
			semicolons: false
		}
	})).code || ""

	script = script
		.replace(/function ?\w+\(/, "function (")

	if (script.length > transpiledSource.length)
		script = transpiledSource

	script = script
		.replace(/\$[\w\$]+\(/g, a => a.replace("$", "#").replace(/\$/g, "."))
		.replace(/\$G[^\w]/g, a => a.replace("$", "#"))

	if (autocompleteMatch)
		script = script.replace(/function \(.*\) \{/, `$& // ${(autocompleteMatch[1] || autocompleteMatch[2]).trim()}`)

	return {
		srcLength,
		script,
		warnings
	}
}

type WriteFileParameters = Parameters<typeof writeFile>

async function writeFilePersist(path: string, data: WriteFileParameters[1], options?: WriteFileParameters[2]) {
	await writeFile(path, data, options).catch(async (error: NodeJS.ErrnoException) => {
		switch (error.code) {
			case "ENOENT":
				await mkDir(resolvePath(path, ".."), { recursive: true })
				await writeFile(path, data, options)
				break
			default:
				throw error
		}
	})
}

type CopyFileParameters = Parameters<typeof copyFile>

async function copyFilePersist(path: CopyFileParameters[0], dest: string, flags?: CopyFileParameters[2]) {
	await copyFile(path, dest, flags).catch(async (error: NodeJS.ErrnoException) => {
		switch (error.code) {
			case "ENOENT":
				await mkDir(resolvePath(dest, ".."), { recursive: true })
				await copyFile(path, dest, flags)
				break
			default:
				throw error
		}
	})
}

function hackmudLength(script: string) {
	return script.replace(/[ \n\r]/g, "").length
}

function positionToLineNumber(position: number, script: string) {
	let totalCharacters = 0

	for (const [ lineNumber, line ] of script.split("\n").entries()) {
		totalCharacters += line.length + 1

		if (position < totalCharacters)
			return lineNumber
	}

	throw new Error("unreachable")
}
