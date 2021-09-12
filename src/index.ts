import { Token, tokenizer as tokenize, tokTypes as tokenTypes } from "acorn"
import { watch as watchDirectory } from "chokidar"
import { generate as generateCodeFromAST } from "escodegen"
import { parseScript } from "esprima"
import { query } from "esquery"
import ASTNodes from "estree"
import fs from "fs"
import { basename as getBaseName, extname as getFileExtension, resolve as resolvePath } from "path"
import { minify } from "terser"
import typescript from "typescript"
import { clearObject, copyFilePersist, hackmudLength, positionToLineNumber, stringSplice, writeFilePersist } from "./lib"

const { readFile: readFile, readdir: readDirectory, stat: getFileStatus, writeFile: writeFile } = fs.promises

export interface Info {
	file: string
	users: string[]
	srcLength: number
	minLength: number
	error: Error | null
}

export const supportedExtensions = [ ".js", ".ts" ]

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

/**
 * Copies script from hackmud to local source folder.
 *
 * @param sourceFolderPath path to folder containing source files
 * @param hackmudPath path to hackmud directory
 * @param script script to pull in `user.name` format
 */
export async function pull(sourceFolderPath: string, hackmudPath: string, script: string) {
	const [ user, name ] = script.split(".")
	await copyFilePersist(resolvePath(hackmudPath, user, "scripts", `${name}.js`), resolvePath(sourceFolderPath, user, `${name}.js`))
}

export async function syncMacros(hackmudPath: string) {
	const files = await readDirectory(hackmudPath, { withFileTypes: true })
	const macros = new Map<string, { macro: string, date: Date }>()
	const users: string[] = []

	for (const file of files) {
		if (!file.isFile())
			continue

		switch (getFileExtension(file.name)) {
			case ".macros": {
				const lines = (await readFile(resolvePath(hackmudPath, file.name), { encoding: "utf-8" })).split("\n")
				const date = (await getFileStatus(resolvePath(hackmudPath, file.name))).mtime

				for (let i = 0; i < lines.length / 2 - 1; i++) {
					const macroName = lines[i * 2]
					const curMacro = macros.get(macroName)

					if (!curMacro || date > curMacro.date)
						macros.set(macroName, { date, macro: lines[i * 2 + 1] })
				}
			} break

			case ".key": {
				users.push(getBaseName(file.name, ".key"))
			} break
		}
	}

	let macroFile = ""
	let macrosSynced = 0

	for (const [ name, { macro } ] of [ ...macros ].sort(([ a ], [ b ]) => (a as any > b as any) - (a as any < b as any))) {
		if (macro[0] != macro[0].toLowerCase())
			continue

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

	for (const dirent of await readDirectory(srcPath, { withFileTypes: true })) {
		if (dirent.isDirectory()) {
			promises.push(readDirectory(resolvePath(srcPath, dirent.name), { withFileTypes: true }).then(files => {
				const promises: Promise<any>[] = []

				for (const file of files) {
					if (!file.isFile() || !supportedExtensions.includes(getFileExtension(file.name)))
						continue

					promises.push(
						readFile(resolvePath(srcPath, dirent.name, file.name), { encoding: "utf-8" })
							.then(processScript)
							.then(({ warnings }) =>
								errors.push(...warnings.map(({ message, line }) => ({
									file: `${dirent.name}/${file.name}`,
									message, line
								})))
							)
					)
				}

				return Promise.all(promises)
			}))
		} else if (dirent.isFile() && supportedExtensions.includes(getFileExtension(dirent.name))) {
			promises.push(
				readFile(resolvePath(srcPath, dirent.name), { encoding: "utf-8" })
					.then(processScript)
					.then(({ warnings }) =>
						errors.push(...warnings.map(({ message, line }) => ({
							file: dirent.name,
							message, line
						})))
					)
			)
		}
	}

	await Promise.all(promises)

	return errors
}

export async function generateTypings(srcDir: string, target: string, hackmudPath?: string) {
	const users = new Set<string>()

	if (hackmudPath) {
		for (const dirent of await readDirectory(hackmudPath, { withFileTypes: true })) {
			if (dirent.isFile() && getFileExtension(dirent.name) == ".key")
				users.add(getBaseName(dirent.name, ".key"))
		}
	}

	const wildScripts: string[] = []
	const wildAnyScripts: string[] = []
	const allScripts: Record<string, string[]> = {}
	const allAnyScripts: Record<string, string[]> = {}

	for (const dirent of await readDirectory(srcDir, { withFileTypes: true })) {
		if (dirent.isFile()) {
			if (getFileExtension(dirent.name) == ".ts")
				wildScripts.push(getBaseName(dirent.name, ".ts"))
			else if (getFileExtension(dirent.name) == ".js")
				wildAnyScripts.push(getBaseName(dirent.name, ".js"))
		} else if (dirent.isDirectory()) {
			const scripts: string[] = allScripts[dirent.name] = []
			const anyScripts: string[] = allAnyScripts[dirent.name] = []

			users.add(dirent.name)

			for (const file of await readDirectory(resolvePath(srcDir, dirent.name), { withFileTypes: true })) {
				if (file.isFile()) {
					if (getFileExtension(file.name) == ".ts")
						scripts.push(getBaseName(file.name, ".ts"))
					else if (getFileExtension(file.name) == ".js")
						anyScripts.push(getBaseName(file.name, ".js"))
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
	let preScriptComments: string | undefined
	let autocomplete: string | undefined

	[ , preScriptComments, script, autocomplete ] = script.match(/((?:^\s*\/\/.*\n)*)\s*((?:.+?\/\/\s*(.+?)\s*$)?[^]*)/m)!

	if (!script)
		throw new Error("script was empty")

	if (script.match(/(?:SC|DB)\$/))
		throw new Error("SC$ and DB$ are protected and cannot appear in a script")

	let seclevel: number | undefined

	for (const line of preScriptComments.split("\n")) {
		let [ , autocompleteMatch, seclevelMatch ] = (line.match(/^\s*\/\/\s*(?:@autocomplete\s*([^\s].*?)|@seclevel\s*([^\s].*?))\s*$/) || []) as [ never, string | undefined, string | undefined ]

		if (autocompleteMatch)
			autocomplete = autocompleteMatch
		else if (seclevelMatch) {
			if (seclevelMatch.match(/^(?:fullsec|f|4|fs|full)$/i))
				seclevel = 4
			else if (seclevelMatch.match(/^(?:highsec|h|3|hs|high)$/i))
				seclevel = 3
			else if (seclevelMatch.match(/^(?:midsec|m|2|ms|mid)$/i))
				seclevel = 2
			else if (seclevelMatch.match(/^(?:lowsec|l|1|ls|low)$/i))
				seclevel = 1
			else if (seclevelMatch.match(/^(?:nullsec|n|0|ns|null)$/i))
				seclevel = 0
		}
	}

	let detectedSeclevel: number | undefined

	if (script.match(/[#$][n0]s\.[a-z_][a-z_0-9]{0,24}\.[a-z_][a-z_0-9]{0,24}\(/))
		detectedSeclevel = 0
	else if (script.match(/[#$][l1]s\.[a-z_][a-z_0-9]{0,24}\.[a-z_][a-z_0-9]{0,24}\(/))
		detectedSeclevel = 1
	else if (script.match(/[#$][m2]s\.[a-z_][a-z_0-9]{0,24}\.[a-z_][a-z_0-9]{0,24}\(/))
		detectedSeclevel = 2
	else if (script.match(/[#$][h3]s\.[a-z_][a-z_0-9]{0,24}\.[a-z_][a-z_0-9]{0,24}\(/))
		detectedSeclevel = 3
	else if (script.match(/[#$][f4]s\.[a-z_][a-z_0-9]{0,24}\.[a-z_][a-z_0-9]{0,24}\(/))
		detectedSeclevel = 4

	const seclevelNames = [ "NULLSEC", "LOWSEC", "MIDSEC", "HIGHSEC", "FULLSEC" ]

	if (seclevel == undefined)
		seclevel = seclevel ?? detectedSeclevel ?? 0
	else if (detectedSeclevel != undefined && seclevel > detectedSeclevel)
		throw new Error(`detected seclevel of ${seclevelNames[detectedSeclevel]} is lower than the provided seclevel of ${seclevelNames[seclevel]}`)

	const semicolons = script.match(/;/g)?.length ?? 0

	script = script
		.replace(/#[fhmln43210]s\.scripts\.quine\(\)/g, JSON.stringify(script))
		.replace(/[#$][fhmln43210]?s\.([a-z_][a-z_0-9]{0,24})\.([a-z_][a-z_0-9]{0,24})\(/g, "SC$$$1$$$2(")
		.replace(/^function\s*\(/, "function script(")
		.replace(/#D\(/g, "$D(")
		.replace(/#FMCL/g, "$FMCL")
		.replace(/#G/g, "$G")
		.replace(/[#$]db\./g, "DB$")

	// typescript compilation, this runs on regular javascript too to convert
	// any post es2015 syntax into es2015 syntax
	const { outputText, diagnostics = [] } = typescript.transpileModule(script, {
		compilerOptions: { target: typescript.ScriptTarget.ES2015 },
		reportDiagnostics: true
	})

	const warnings = diagnostics.map(({ messageText, start }) => ({
		message: typeof messageText == "string" ? messageText : messageText.messageText,
		line: positionToLineNumber(start!, script)
	}))

	script = outputText.replace(/^export /, "")

	await writeFile("./test.json", JSON.stringify(parseScript(script), null, "\t"))

	const ast = parseScript(script)

	for (const node of query(ast, "ClassBody > MethodDefinition[kind=constructor] > FunctionExpression > BlockStatement") as ASTNodes.BlockStatement[]) {
		node.body.unshift({
			type: "VariableDeclaration",
			declarations: [
				{
					type: "VariableDeclarator",
					id: {
						type: "Identifier",
						name: "__THIS__"
					}
				}
			],
			kind: "let"
		})
	}

	for (const node of query(ast, "ClassBody > MethodDefinition[kind=constructor] > FunctionExpression > BlockStatement !CallExpression > Super") as ASTNodes.CallExpression[]) {
		const newNode: ASTNodes.AssignmentExpression = {
			type: "AssignmentExpression",
			operator: "=",
			left: {
				type: "Identifier",
				name: "__THIS__"
			},
			right: { ...node }
		}

		Object.assign(clearObject(node), newNode)
	}

	for (const node of query(ast, "ClassBody > MethodDefinition > FunctionExpression > BlockStatement !ThisExpression") as ASTNodes.ThisExpression[]) {
		const newNode: ASTNodes.Identifier = {
			type: "Identifier",
			name: "__THIS__"
		}

		Object.assign(clearObject(node), newNode)
	}

	for (const node of query(ast, "ClassBody > MethodDefinition[kind=method] > FunctionExpression > BlockStatement") as ASTNodes.BlockStatement[]) {
		node.body.unshift({
			type: "VariableDeclaration",
			declarations: [ {
				type: "VariableDeclarator",
				id: {
					type: "Identifier",
					name: "__THIS__"
				},
				init: {
					type: "CallExpression",
					callee: {
						type: "MemberExpression",
						computed: false,
						object: {
							type: "Super"
						},
						property: {
							type: "Identifier",
							name: "valueOf"
						},
						optional: false
					},
					arguments: [],
					optional: false
				}
			} ],
			"kind": "let"
		})
	}

	script = generateCodeFromAST(ast)

	// the typescript inserts semicolons where they weren't already so we take
	// all semicolons out of the count and add the number of semicolons in the
	// source to make things fair
	let srcLength = hackmudLength(script.replace(/^function\s*\w+\(/, "function("))
		- (script.match(/;/g)?.length ?? 0)
		+ semicolons
		+ (script.match(/SC\$[a-zA-Z_][a-zA-Z0-9_]*\$[a-zA-Z_][a-zA-Z0-9_]*\(/g)?.length ?? 0)
		+ (script.match(/DB\$/g)?.length ?? 0)

	// remove dead code (so we don't waste chracters quine cheating strings
	// that aren't even used)
	script = (await minify(script, {
		ecma: 2015,
		parse: { bare_returns: true },
		compress: { booleans: false }
	})).code || ""

	let blockStatementIndex: number

	if (script.startsWith("function "))
		blockStatementIndex = getFunctionBodyStart(script)
	else {
		script = `function script(context, args) {\n${script}\n}`
		blockStatementIndex = 31
		srcLength += 24
	}

	let scriptBeforeJSONValueReplacement = (await minify(script, {
		ecma: 2015,
		compress: {
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
		format: { semicolons: false }
	})).code || ""

	{
		const tokens = [ ...tokenize(scriptBeforeJSONValueReplacement, { ecmaVersion: 2015 }) ].reverse().values()

		for (const token of tokens) {
			// we can't replace any tokens before the block statement or we'll break stuff
			if (token.start < blockStatementIndex)
				break

			switch (token.type) {
				case tokenTypes.name: {
					if (token.value != "prototype" && token.value != "__proto__")
						break

					const tokenBefore = tokens.next().value as Token

					if (tokenBefore.type != tokenTypes.dot)
						break

					srcLength += 3
					scriptBeforeJSONValueReplacement = stringSplice(scriptBeforeJSONValueReplacement, `["${token.value}"]`, tokenBefore.start, token.end)
				} break

				case tokenTypes._const: {
					scriptBeforeJSONValueReplacement = stringSplice(scriptBeforeJSONValueReplacement, "let", token.start, token.end)
				} break

				case tokenTypes._this:
					throw new Error('"this" keyword is not supported in hackmud')
			}
		}
	}

	const jsonValues: any[] = []
	let undefinedIsReferenced = false

	// we iterate through the tokens backwards so that substring replacements
	// don't affect future replacements since a part of the string could be
	// replaced with a string of a different length which messes up indexes
	const tokens = [ ...tokenize(script, { ecmaVersion: 2015 }) ].reverse().values()

	let templateToRightOfPlaceholder = false

	for (const token of tokens) {
		// we can't replace any tokens before the block statement or we'll break stuff
		if (token.start < blockStatementIndex)
			break

		switch (token.type) {
			case tokenTypes.backQuote: {
				const templateToken = tokens.next().value as Token

				if ((tokens.next().value as Token).type == tokenTypes.backQuote)
					throw new Error("tagged templates not supported yet")

				// no point in concatenating an empty string
				if (templateToken.value == "") {
					script = stringSplice(script, "))", templateToken.start - 1, token.end)
					break
				}

				let jsonValueIndex = jsonValues.indexOf(templateToken.value)

				if (jsonValueIndex == -1)
					jsonValueIndex += jsonValues.push(templateToken.value)

				script = stringSplice(script, `)+_JSON_VALUE_${jsonValueIndex}_)`, templateToken.start - 1, token.end)
			} break

			case tokenTypes.template: {
				if ((tokens.next().value as Token).type == tokenTypes.backQuote) {
					if ((tokens.next().value as Token).type == tokenTypes.name)
						throw new Error("tagged templates not supported yet")

					// there *is* a point in concatenating an empty string at the
					// start because foo + bar is not the same thing as "" + foo + bar
					// ...but foo + "<template>" + bar *is* the same thing as "" + foo + "<template>" + bar
					// so we just need to check if there's a template to the right of the placeholder and skip that case

					if (token.value == "" && templateToRightOfPlaceholder) {
						templateToRightOfPlaceholder = false
						script = stringSplice(script, "((", token.start - 1, token.end + 2)
						break
					}

					templateToRightOfPlaceholder = false

					let jsonValueIndex = jsonValues.indexOf(token.value)

					if (jsonValueIndex == -1)
						jsonValueIndex += jsonValues.push(token.value)

					script = stringSplice(script, `(_JSON_VALUE_${jsonValueIndex}_+(`, token.start - 1, token.end + 2)
					break
				}

				// no point in concatenating an empty string
				if (token.value == "") {
					templateToRightOfPlaceholder = false
					script = stringSplice(script, ")+(", token.start - 1, token.end + 2)
					break
				}

				templateToRightOfPlaceholder = true

				let jsonValueIndex = jsonValues.indexOf(token.value)

				if (jsonValueIndex == -1)
					jsonValueIndex += jsonValues.push(token.value)

				script = stringSplice(script, `)+_JSON_VALUE_${jsonValueIndex}_+(`, token.start - 1, token.end + 2)
			} break

			case tokenTypes.name: {
				if (token.value.length < 3)
					break

				const tokenBefore = tokens.next().value as Token

				if (tokenBefore.type == tokenTypes.dot) {
					let jsonValueIndex = jsonValues.indexOf(token.value)

					if (jsonValueIndex == -1)
						jsonValueIndex += jsonValues.push(token.value)

					script = stringSplice(script, `[_JSON_VALUE_${jsonValueIndex}_]`, tokenBefore.start, token.end)
					break
				}

				if (token.value == "undefined") {
					script = stringSplice(script, " _UNDEFINED_ ", token.start, token.end)
					undefinedIsReferenced = true
				}
			} break

			case tokenTypes._null: {
				let jsonValueIndex = jsonValues.indexOf(null)

				if (jsonValueIndex == -1)
					jsonValueIndex += jsonValues.push(null)

				script = stringSplice(script, ` _JSON_VALUE_${jsonValueIndex}_ `, token.start, token.end)
			} break

			case tokenTypes._true: {
				let jsonValueIndex = jsonValues.indexOf(true)

				if (jsonValueIndex == -1)
					jsonValueIndex += jsonValues.push(true)

				script = stringSplice(script, ` _JSON_VALUE_${jsonValueIndex}_ `, token.start, token.end)
			} break

			case tokenTypes._false: {
				let jsonValueIndex = jsonValues.indexOf(false)

				if (jsonValueIndex == -1)
					jsonValueIndex += jsonValues.push(false)

				script = stringSplice(script, ` _JSON_VALUE_${jsonValueIndex}_ `, token.start, token.end)
			} break

			case tokenTypes.num: {
				if (token.value == 0) {
					const tokenBefore = tokens.next().value as Token

					if (tokenBefore.type == tokenTypes._void) {
						script = stringSplice(script, " _UNDEFINED_ ", tokenBefore.start, token.end)
						undefinedIsReferenced = true
					}

					// may as well break here since we're gonna break anyway
					break
				}

				if (token.value < 10)
					break

				let jsonValueIndex = jsonValues.indexOf(token.value)

				if (jsonValueIndex == -1)
					jsonValueIndex += jsonValues.push(token.value)

				script = stringSplice(script, ` _JSON_VALUE_${jsonValueIndex}_ `, token.start, token.end)
			} break

			case tokenTypes.string: {
				if (token.value.includes("\u0000"))
					break

				let jsonValueIndex = jsonValues.indexOf(token.value)

				if (jsonValueIndex == -1)
					jsonValueIndex += jsonValues.push(token.value)

				script = stringSplice(script, ` _JSON_VALUE_${jsonValueIndex}_ `, token.start, token.end)
			} break

			case tokenTypes._const: {
				script = stringSplice(script, "let", token.start, token.end)
			} break

			case tokenTypes._this:
				throw new Error('"this" keyword is not supported in hackmud')
		}
	}

	let comment: string | null = null
	let hasComment = false

	if (jsonValues.length) {
		hasComment = true

		if (jsonValues.length == 1) {
			if (typeof jsonValues[0] == "string" && !jsonValues[0].includes("\n") && !jsonValues[0].includes("\t")) {
				script = stringSplice(script, `\nlet _JSON_VALUE_0_ = SC$scripts$quine().split\`\t\`[_SPLIT_INDEX_]${undefinedIsReferenced ? ", _UNDEFINED_" : ""}\n`, blockStatementIndex + 1)
				comment = jsonValues[0]
			} else {
				script = stringSplice(script, `\nlet _JSON_VALUE_0_ = JSON.parse(SC$scripts$quine().split\`\t\`[_SPLIT_INDEX_])${undefinedIsReferenced ? ", _UNDEFINED_" : ""}\n`, blockStatementIndex + 1)
				comment = JSON.stringify(jsonValues[0])
			}
		} else {
			script = stringSplice(script, `\nlet [ ${jsonValues.map((_, i) => `_JSON_VALUE_${i}_`).join(", ")} ] = JSON.parse(SC$scripts$quine().split\`\t\`[_SPLIT_INDEX_])${undefinedIsReferenced ? ", _UNDEFINED_" : ""}\n`, blockStatementIndex + 1)
			comment = JSON.stringify(jsonValues)
		}
	} else
		script = script.replace(/_UNDEFINED_/g, "void 0")

	script = (await minify(script, {
		ecma: 2015,
		compress: {
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
		format: { semicolons: false }
	})).code || ""

	// this step affects the chracter count and can't be done after the count comparison
	if (comment != null) {
		script = stringSplice(script, `${autocomplete ? `//${autocomplete}\n` : ""}\n//\t${comment}\t\n`, getFunctionBodyStart(script) + 1)

		for (const [ i, part ] of script.split("\t").entries()) {
			if (part != comment)
				continue

			script = script.replace("_SPLIT_INDEX_", (await minify(`$(${i})`, { ecma: 2015 })).code!.match(/\$\((.+)\)/)![1])
			break
		}
	}

	// if the script has a comment, it's gonna contain `SC$scripts$quine()`
	// which is gonna eventually compile to `#fs.scripts.quine()` which contains
	// an extra character so we have to account for that
	if (hackmudLength(scriptBeforeJSONValueReplacement) <= (hackmudLength(script) + Number(hasComment))) {
		script = scriptBeforeJSONValueReplacement

		if (autocomplete)
			script = stringSplice(script, `//${autocomplete}\n`, getFunctionBodyStart(script) + 1)
	}

	script = script
		.replace(/^function\s*\w+\(/, "function(")
		.replace(/SC\$([a-zA-Z_][a-zA-Z0-9_]*)\$([a-zA-Z_][a-zA-Z0-9_]*)\(/g, `#${"nlmhf"[seclevel]}s.$1.$2(`)
		.replace(/\$D\(/g, "#D(")
		.replace(/\$FMCL/g, "#FMCL")
		.replace(/\$G/g, "#G")
		.replace(/DB\$/g, "#db.")

	return {
		srcLength,
		script,
		warnings
	}
}

export function getFunctionBodyStart(code: string) {
	const tokens = tokenize(code, { ecmaVersion: 2015 })

	tokens.getToken() // function
	tokens.getToken() // name
	tokens.getToken() // (

	let nests = 1

	while (nests) {
		const token = tokens.getToken()

		if (token.type == tokenTypes.parenL)
			nests++
		else if (token.type == tokenTypes.parenR)
			nests--
	}

	return tokens.getToken().start // {
}
