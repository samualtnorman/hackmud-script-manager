#!/usr/bin/env node
import type { Replace } from "@samual/lib"
import { AutoMap } from "@samual/lib/AutoMap"
import { assert } from "@samual/lib/assert"
import { countHackmudCharacters } from "@samual/lib/countHackmudCharacters"
import { writeFilePersistent } from "@samual/lib/writeFilePersistent"
import { readFile, writeFile } from "fs/promises"
import { homedir as getHomeDirectory } from "os"
import {
	basename as getPathBaseName, dirname as getPathDirectory, extname as getPathFileExtension,
	relative as getRelativePath, resolve as resolvePath
} from "path"
import type { Info } from ".."
import { version as moduleVersion } from "../../package.json"
import { supportedExtensions } from "../constants"
import { generateTypeDeclaration } from "../generateTypeDeclaration"
import { pull } from "../pull"
import { syncMacros } from "../syncMacros"

type OptionValue = boolean | string

const formatOption = (name: string) => colourN(`-${name.length == 1 ? `` : `-`}${name}`)
const options = new Map<string, OptionValue>()
const commands: string[] = []

const userColours = new AutoMap<string, string>(user => {
	let hash = 0

	for (const char of user)
		hash += (hash >> 1) + hash + `xi1_8ratvsw9hlbgm02y5zpdcn7uekof463qj`.indexOf(char) + 1

	return [ colourJ, colourK, colourM, colourW, colourL, colourB ][hash % 6]!(user)
})

const log = (message: string) => console.log(colourS(message))

for (const argument of process.argv.slice(2)) {
	if (argument[0] == `-`) {
		const argumentEqualsIndex = argument.indexOf(`=`)
		let key
		let value

		if (argumentEqualsIndex == -1) {
			key = argument
			value = true
		} else {
			key = argument.slice(0, argumentEqualsIndex)
			value = argument.slice(argumentEqualsIndex + 1)

			if (value == `true`)
				value = true
			else if (value == `false`)
				value = false
		}

		if (argument[1] == `-`)
			options.set(key!.slice(2), value)
		else {
			for (const option of key!.slice(1))
				options.set(option, value)
		}
	} else
		commands.push(argument)
}

const pushModule = import(`../push`)
const processScriptModule = import(`../processScript`)
const watchModule = import(`../watch`)
const chokidarModule = import(`chokidar`)

const { default: chalk } = await import(`chalk`)

const colourA = chalk.rgb(0xFF, 0xFF, 0xFF)
const colourB = chalk.rgb(0xCA, 0xCA, 0xCA)
const colourC = chalk.rgb(0x9B, 0x9B, 0x9B)
const colourD = chalk.rgb(0xFF, 0x00, 0x00)
const colourF = chalk.rgb(0xFF, 0x80, 0x00)
const colourJ = chalk.rgb(0xFF, 0xF4, 0x04)
const colourK = chalk.rgb(0xF3, 0xF9, 0x98)
const colourL = chalk.rgb(0x1E, 0xFF, 0x00)
const colourM = chalk.rgb(0xB3, 0xFF, 0x9B)
const colourN = chalk.rgb(0x00, 0xFF, 0xFF)
const colourS = chalk.rgb(0x7A, 0xB2, 0xF4)
const colourV = chalk.rgb(0xFF, 0x00, 0xEC)
const colourW = chalk.rgb(0xFF, 0x96, 0xE0)

if (process.version.startsWith(`v21.`)) {
	process.exitCode = 1

	console.warn(colourF(`\
${chalk.bold(`Warning:`)} Support for Node.js 21 will be dropped in the next minor version of HSM
         Your current version of Node.js is ${chalk.bold(process.version)}
         You should update your version of Node.js
         https://nodejs.org/en/download/package-manager\n`
	))
}

if (commands[0] == `v` || commands[0] == `version` || popOption(`version`, `v`)?.value) {
	console.log(moduleVersion)
	process.exit()
}

let warnedDeprecatedEmitDtsAlias = false

if (popOption(`help`, `h`)?.value) {
	logHelp()
	process.exit()
}

let autoExit = true

switch (commands[0]) {
	case `push`:
	case `dev`:
	case `watch`:
	case `golf`:
	case `minify`: {
		const noMinifyOption = popOption(`no-minify`, `skip-minify`)

		if (noMinifyOption && noMinifyOption.name != `no-minify`) {
			process.exitCode = 1

			console.warn(colourF(`\
${chalk.bold(`Warning:`)} ${formatOption(noMinifyOption.name)} is deprecated and will be removed in the next minor
         release of HSM
         You should switch to using its alias ${colourN(`--no-minify`)}\n`
			))
		}

		const mangleNamesOption = popOption(`mangle-names`)
		const forceQuineCheatsOption = popOption(`force-quine-cheats`)
		const noQuineCheatsOptions = popOption(`no-quine-cheats`)
		const noMinifyIncompatibleOption = mangleNamesOption || forceQuineCheatsOption || noQuineCheatsOptions

		if (noMinifyOption && noMinifyIncompatibleOption) {
			logError(
				`Options ${formatOption(noMinifyOption.name)} and ${formatOption(noMinifyIncompatibleOption.name)
				} are incompatible\n`
			)

			logHelp()
			process.exit(1)
		}

		if (forceQuineCheatsOption && noQuineCheatsOptions) {
			logError(
				`Options ${formatOption(forceQuineCheatsOption.name)} and ${formatOption(noQuineCheatsOptions.name)
				} are incompatible\n`
			)

			logHelp()
			process.exit(1)
		}

		if (noMinifyOption)
			assertOptionIsBoolean(noMinifyOption)

		if (mangleNamesOption)
			assertOptionIsBoolean(mangleNamesOption)

		if (forceQuineCheatsOption)
			assertOptionIsBoolean(forceQuineCheatsOption)

		if (noQuineCheatsOptions)
			assertOptionIsBoolean(noQuineCheatsOptions)

		const rootFolderPathOption = popOption(`root-folder-path`)
		const rootFolderPath = rootFolderPathOption && resolvePath(String(rootFolderPathOption.value))

		if (commands[0] == `golf` || commands[0] == `minify`) {
			const watchOption = popOption(`watch`)
			const target = commands[1]

			if (!target) {
				logError(`Must provide target\n`)
				logHelp()
				process.exit(1)
			}

			const fileExtension = getPathFileExtension(target)

			if (!supportedExtensions.includes(fileExtension)) {
				logError(`Unsupported file extension "${chalk.bold(fileExtension)}"\nSupported extensions are "${
					supportedExtensions.map(extension => chalk.bold(extension)).join(`", "`)
				}"`)

				process.exit(1)
			}

			complainAboutUnrecognisedOptions()

			const { processScript } = await processScriptModule
			const fileBaseName = getPathBaseName(target, fileExtension)
			const fileBaseNameEndsWithDotSrc = fileBaseName.endsWith(`.src`)
			const scriptName = fileBaseNameEndsWithDotSrc ? fileBaseName.slice(0, -4) : fileBaseName

			const scriptUser = (
				getPathBaseName(resolvePath(target, `..`)) == `scripts` &&
				getPathBaseName(resolvePath(target, `../../..`)) == `hackmud`
			) ? getPathBaseName(resolvePath(target, `../..`)) : undefined

			let outputPath = commands[2] || resolvePath(
				getPathDirectory(target),
				fileBaseNameEndsWithDotSrc
					? `${scriptName}.js`
					: (fileExtension == `.js` ? `${fileBaseName}.min.js` : `${fileBaseName}.js`)
			)

			const golfFile = () => readFile(target, { encoding: `utf8` }).then(async source => {
				const timeStart = performance.now()

				const { script, warnings } = await processScript(source, {
					minify: noMinifyOption && !noMinifyOption.value,
					scriptUser,
					scriptName,
					filePath: target,
					mangleNames: mangleNamesOption?.value,
					forceQuineCheats: forceQuineCheatsOption?.value ?? !noQuineCheatsOptions?.value,
					rootFolderPath
				})

				const timeTook = performance.now() - timeStart

				if (warnings.length)
					process.exitCode = 1

				for (const { message } of warnings)
					console.warn(colourF(`${chalk.bold(`Warning:`)} ${message}`))

				await writeFilePersistent(outputPath, script).catch((error: NodeJS.ErrnoException) => {
					if (!commands[2] || error.code != `EISDIR`)
						throw error

					outputPath = resolvePath(outputPath, `${getPathBaseName(target, fileExtension)}.js`)

					return writeFilePersistent(outputPath, script)
				}).then(() => log(`Wrote ${chalk.bold(countHackmudCharacters(script))} chars to ${
					chalk.bold(getRelativePath(`.`, outputPath))
				} | took ${Math.round(timeTook * 100) / 100}ms`))
			})

			if (watchOption) {
				const { watch: watchFile } = await chokidarModule

				watchFile(target, { awaitWriteFinish: { stabilityThreshold: 100 } })
					.on(`ready`, () => log(`Watching ${target}`)).on(`change`, golfFile)

				autoExit = false
			} else
				await golfFile()
		} else {
			const hackmudPath = getHackmudPath()
			const sourcePath = commands[1]

			if (!sourcePath) {
				logError(`Must provide the directory to ${commands[0] == `push` ? `push from` : `watch`}\n`)
				logHelp()
				process.exit(1)
			}

			const scripts = commands.slice(2)

			if (scripts.length) {
				const invalidScript = scripts
					.find(script => !/^(?:[a-z_][a-z\d_]{0,24}|\*)\.(?:[a-z_][a-z\d_]{0,24}|\*)$/.test(script))

				if (invalidScript) {
					logError(`Invalid script name: ${JSON.stringify(invalidScript)}\n`)
					logHelp()
					process.exit(1)
				}
			} else
				scripts.push(`*.*`)

			const watchOption = popOption(`watch`)

			if (commands[0] == `push` && !watchOption?.value) {
				const dtsPathOption = popOption(`dts-path`)

				complainAboutUnrecognisedOptions()

				let declarationPathPromise

				if (dtsPathOption) {
					if (typeof dtsPathOption.value != `string`) {
						logError(
							`Option ${formatOption(dtsPathOption.name)} must be a string, got ${colourV(dtsPathOption.value)
								}\n`
						)

						logHelp()
						process.exit(1)
					}

					let typeDeclarationPath = resolvePath(dtsPathOption.value)
					const typeDeclaration = await generateTypeDeclaration(sourcePath, hackmudPath)

					declarationPathPromise = writeFile(typeDeclarationPath, typeDeclaration).catch(error => {
						assert(error instanceof Error, HERE)

						if ((error as NodeJS.ErrnoException).code != `EISDIR`)
							throw error

						typeDeclarationPath = resolvePath(typeDeclarationPath, `player.d.ts`)

						return writeFile(typeDeclarationPath, typeDeclaration)
					}).then(() => typeDeclarationPath)
				}

				const { push, MissingSourceFolderError, MissingHackmudFolderError, NoUsersError } = await pushModule

				const infos = await push(sourcePath, hackmudPath, {
					scripts,
					onPush: info => logInfo(info, hackmudPath),
					minify: noMinifyOption && !noMinifyOption.value,
					mangleNames: mangleNamesOption?.value,
					forceQuineCheats: forceQuineCheatsOption?.value ?? !noQuineCheatsOptions?.value,
					rootFolderPath
				})

				if (infos instanceof Error) {
					logError(infos.message)

					if (infos instanceof MissingSourceFolderError || infos instanceof NoUsersError) {
						console.log()
						logHelp()
					} else if (infos instanceof MissingHackmudFolderError) {
						log(`\
If this is not where your hackmud folder is, you can specify it with the
${colourN(`--hackmud-path`)}=${colourB(`<path>`)} option or ${colourN(`HSM_HACKMUD_PATH`)} environment variable`
						)
					}
				} else if (!infos.length)
					logError(`Could not find any scripts to push`)

				if (declarationPathPromise)
					log(`Wrote type declaration to ${chalk.bold(await declarationPathPromise)}`)
			} else {
				const dtsPathOption =
					popOption(`dts-path`, `type-declaration-path`, `type-declaration`, `dts`, `gen-types`)

				if (dtsPathOption && dtsPathOption.name != `dts-path` && dtsPathOption.name != `type-declaration-path`) {
					process.exitCode = 1

					console.warn(colourF(`\
${chalk.bold(`Warning:`)} ${formatOption(dtsPathOption.name)} is deprecated and will be removed in the
         next minor release of HSM
         You should switch to using its alias ${colourN(`--dts-path`)}\n`
					))
				}

				complainAboutUnrecognisedOptions()

				const { watch } = await watchModule

				watch(sourcePath, hackmudPath, {
					scripts,
					onPush: info => logInfo(info, hackmudPath),
					typeDeclarationPath: dtsPathOption?.value.toString(),
					minify: noMinifyOption && !noMinifyOption.value,
					mangleNames: mangleNamesOption?.value,
					onReady: () => log(`Watching`),
					forceQuineCheats: forceQuineCheatsOption?.value ?? !noQuineCheatsOptions?.value,
					rootFolderPath
				})

				autoExit = false
			}
		}
	} break

	case `pull`: {
		const hackmudPath = getHackmudPath()
		const script = commands[1]

		if (!script) {
			logError(`Must provide the script to pull\n`)
			logHelp()
			process.exit(1)
		}

		complainAboutUnrecognisedOptions()

		const sourcePath = commands[2] || `.`

		await pull(sourcePath, hackmudPath, script).catch(error => {
			console.error(error)
			logError(`Something went wrong, did you forget to ${colourC(`#down`)} the script?`)
		})
	} break

	case `sync-macros`: {
		const hackmudPath = getHackmudPath()

		complainAboutUnrecognisedOptions()

		const { macrosSynced, usersSynced } = await syncMacros(hackmudPath)

		log(`Synced ${macrosSynced} macros to ${usersSynced} users`)
	} break

	case `generate-type-declaration`:
	case `gen-type-declaration`:
	case `gen-dts`:
	case `gen-types`:
	case `emit-dts`: {
		if (commands[0] != `emit-dts` && commands[0] != `gen-dts`) {
			warnedDeprecatedEmitDtsAlias = true
			process.exitCode = 1

			console.warn(colourF(`\
${chalk.bold(`Warning:`)} ${colourC(`hsm`)} ${colourL(commands[0])} is deprecated and will be removed
         in the next minor release of HSM
         You should switch to using its alias ${colourC(`hsm`)} ${colourL(`emit-dts`)}\n`
			))
		}

		const hackmudPath = getHackmudPath()
		const target = commands[1]

		if (!target) {
			logError(`Must provide target directory\n`)
			logHelp()
			process.exit(1)
		}

		complainAboutUnrecognisedOptions()

		const sourcePath = resolvePath(target)
		const outputPath = commands[2] || `./player.d.ts`

		const typeDeclaration =
			await generateTypeDeclaration(sourcePath, hackmudPath)

		let typeDeclarationPath = resolvePath(outputPath)

		await writeFile(typeDeclarationPath, typeDeclaration).catch(error => {
			assert(error instanceof Error, HERE)

			if ((error as NodeJS.ErrnoException).code != `EISDIR`)
				throw error

			typeDeclarationPath = resolvePath(typeDeclarationPath, `player.d.ts`)

			return writeFile(typeDeclarationPath, typeDeclaration)
		})

		log(`Wrote type declaration to ${chalk.bold(typeDeclarationPath)}`)
	} break

	case `help`: {
		logHelp()
	} break

	default: {
		if (commands[0])
			logError(`Unknown command: ${colourL(commands[0])}\n`)

		logHelp()
	}
}

if (autoExit)
	process.exit()

function logHelp() {
	const pushCommandDescription = `Push scripts from a directory to hackmud user's scripts directories`
	const watchCommandDescription = `Watch a directory and push a script when modified`
	const minifyCommandDescription = `Minify a script file on the spot`
	const generateTypeDeclarationCommandDescription = `Generate a type declaration file for a directory of scripts`
	const syncMacrosCommandDescription = `Sync macros across all hackmud users`
	const pullCommandDescription = `Pull a script a from a hackmud user's script directory`

	const noMinifyOptionDescription = `Skip minification to produce a "readable" script`
	const mangleNamesOptionDescription = `Reduce character count further but lose function names in error call stacks`
	const forceQuineCheatsOptionDescription = `Force quine cheats on or off`

	const hackmudPathOption = `\
${colourN(`--hackmud-path`)}=${colourB(`<path>`)}
    Override hackmud path`

	switch (commands[0]) {
		case `dev`:
		case `watch`:
		case `push`: {
			console.log(colourS(`\
${colourJ(commands[0] == `push` ? pushCommandDescription : watchCommandDescription)}

${colourA(`Usage:`)}
${colourC(`hsm`)} ${colourL(commands[0])} ${colourB(`<directory> ["<script user>.<script name>"...]`)}

${colourA(`Arguments:`)}
${colourB(`<directory>`)}
    The source directory containing your scripts
${colourB(`<script user>`)}
    A user to push script(s) to. Can be set to wild card (${colourV(`*`)}) which will try
    and discover users to push to
${colourB(`<script name>`)}
    Name of a script to push. Can be set to wild card (${colourV(`*`)}) to find all scripts

${colourA(`Options:`)}
${colourN(`--no-minify`)}
    ${noMinifyOptionDescription}
${colourN(`--mangle-names`)}
    ${mangleNamesOptionDescription}
${colourN(`--force-quine-cheats`)}, ${colourN(`--no-quine-cheats`)}
    ${forceQuineCheatsOptionDescription}
${hackmudPathOption}
${colourN(`--dts-path`)}=${colourB(`<path>`)}
    Path to generate a type declaration (.d.ts) file for the scripts
${colourN(`--watch`)}
    Watch for changes
${colourN(`--root-folder-path`)}
    The folder that root will be aliased to in import statements

${colourA(`Examples:`)}
${colourC(`hsm`)} ${colourL(commands[0])} ${colourV(`src`)}
    Pushes all scripts found in ${colourV(`src`)} folder to all users
${colourC(`hsm`)} ${colourL(commands[0])} ${colourV(`src`)} ${colourC(`foo`)}${colourV(`.`)}${colourL(`bar`)}
    Pushes a script named ${colourL(`bar`)} found in ${colourV(`src`)} folder to user ${userColours.get(`foo`)}
${colourC(`hsm`)} ${colourL(commands[0])} ${colourV(`src`)} ${colourC(`foo`)}${colourV(`.`)}${colourL(`bar`)} ${colourC(`baz`)}${colourV(`.`)}${colourL(`qux`)}
    Multiple can be specified
${colourC(`hsm`)} ${colourL(commands[0])} ${colourV(`src`)} ${colourC(`foo`)}${colourV(`.`)}${colourL(`*`)}
    Pushes all scripts found in ${colourV(`src`)} folder to user ${userColours.get(`foo`)}
${colourC(`hsm`)} ${colourL(commands[0])} ${colourV(`src`)} ${colourC(`*`)}${colourV(`.`)}${colourL(`foo`)}
    Pushes all scripts named ${colourL(`foo`)} found in ${colourV(`src`)} folder to all user
${colourC(`hsm`)} ${colourL(commands[0])} ${colourV(`src`)} ${colourC(`*`)}${colourV(`.`)}${colourL(`*`)}
    Pushes all scripts found in ${colourV(`src`)} folder to all users`
			))
		} break

		case `pull`: {
			console.log(colourS(`\
${colourJ(pullCommandDescription)}

${colourA(`Usage:`)}
${colourC(`hsm`)} ${colourL(commands[0])} ${colourB(`<script user>`)}${colourV(`.`)}${colourB(`<script name>`)}

${colourA(`Options:`)}
${hackmudPathOption}`
			))
		} break

		case `minify`:
		case `golf`: {
			console.log(colourS(`\
${colourJ(minifyCommandDescription)}

${colourA(`Usage:`)}
${colourC(`hsm`)} ${colourL(commands[0])} ${colourB(`<target> [output path]`)}

${colourA(`Options:`)}
${colourN(`--no-minify`)}
    ${noMinifyOptionDescription}
${colourN(`--mangle-names`)}
    ${mangleNamesOptionDescription}
${colourN(`--force-quine-cheats`)}, ${colourN(`--no-quine-cheats`)}
    ${forceQuineCheatsOptionDescription}
${colourN(`--watch`)}
    Watch for changes
${colourN(`--root-folder-path`)}
    The folder that root will be aliased to in import statements`
			))
		} break

		case `generate-type-declaration`:
		case `gen-type-declaration`:
		case `gen-dts`:
		case `gen-types`:
		case `emit-dts`: {
			if (!warnedDeprecatedEmitDtsAlias && commands[0] != `emit-dts` && commands[0] != `gen-dts`) {
				process.exitCode = 1

				console.warn(colourF(`\
${chalk.bold(`Warning:`)} ${colourC(`hsm`)} ${colourL(commands[0])} is deprecated and will be removed
         in the next minor release of HSM
         You should switch to using its alias ${colourC(`hsm`)} ${colourL(`emit-dts`)}\n`
				))
			}

			console.log(colourS(`\
${colourJ(generateTypeDeclarationCommandDescription)}

${colourA(`Usage:`)}
${colourC(`hsm`)} ${colourL(commands[0])} ${colourB(`<directory> [output path]`)}

${colourA(`Options:`)}
${hackmudPathOption}`
			))
		} break

		case `sync-macros`: {
			console.log(colourS(`\
${colourJ(syncMacrosCommandDescription)}

${colourA(`Options:`)}
${hackmudPathOption}`
			))
		} break

		default: {
			console.log(colourS(`\
${colourJ(`Hackmud Script Manager`)}
${colourN(`Version`) + colourS(`: `) + colourV(moduleVersion)}

${colourA(`Commands:`)}
${colourL(`push`)}
    ${pushCommandDescription}
${colourL(`minify`)}
    ${minifyCommandDescription}
${colourL(`emit-dts`)}
    ${generateTypeDeclarationCommandDescription}
${colourL(`sync-macros`)}
    ${syncMacrosCommandDescription}
${colourL(`pull`)}
    ${pullCommandDescription}

${colourA(`Options:`)}
${colourN(`--help`)}
    Can be used on any command e.g. ${colourC(`hsm`)} ${colourL(`push`)} ${colourN(`--help`)} to show helpful information`
			))
		}
	}
}

function logInfo({ path, users, characterCount, error, warnings }: Info, hackmudPath: string) {
	path = getRelativePath(`.`, path)

	if (error) {
		logError(`Error "${chalk.bold(error.message)}" in ${chalk.bold(path)}`)

		return
	}

	if (warnings.length)
		process.exitCode = 1

	for (const warning of warnings)
		console.warn(colourF(`${chalk.bold(`Warning:`)} ${warning.message}`))

	log(`Pushed ${chalk.bold(path)} to ${users.map(user => chalk.bold(userColours.get(user))).join(`, `)} | ${
		chalk.bold(String(characterCount))
	} chars | ${chalk.bold(
		`${resolvePath(hackmudPath!, users[0]!, `scripts`, getPathBaseName(path, getPathFileExtension(path)))}.js`
	)}`)
}

function logError(message: string) {
	console.error(colourD(message))
	process.exitCode = 1
}

function getHackmudPath() {
	const hackmudPathOption = popOption(`hackmud-path`)

	if (hackmudPathOption) {
		if (typeof hackmudPathOption.value != `string`) {
			logError(`Option ${colourN(`--hackmud-path`)} must be a string, got ${colourV(hackmudPathOption.value)}\n`)
			logHelp()
			process.exit(1)
		}

		if (!hackmudPathOption.value) {
			logError(`Option ${colourN(`--hackmud-path`)} was specified but empty\n`)
			logHelp()
			process.exit(1)
		}

		return hackmudPathOption.value
	}

	if (process.env.HSM_HACKMUD_PATH != undefined) {
		if (!process.env.HSM_HACKMUD_PATH) {
			logError(`Environment variable ${colourN(`HSM_HACKMUD_PATH`)} was specified but empty\n`)
			logHelp()
			process.exit(1)
		}

		return process.env.HSM_HACKMUD_PATH
	}

	return process.platform == `win32`
		? resolvePath(process.env.APPDATA!, `hackmud`)
		: resolvePath(getHomeDirectory(), `.config/hackmud`)
}

type Option = { name: string, value: OptionValue }

function assertOptionIsBoolean(option: Option): asserts option is Replace<Option, { value: boolean }> {
	if (typeof option.value != `boolean`) {
		logError(`The value for ${formatOption(option.name)} must be ${colourV(`true`)} or ${colourV(`false`)}\n`)
		logHelp()
		process.exit(1)
	}
}

function popOption(...names: string[]): Option | undefined {
	const presentOptionNames = names.filter(name => options.has(name))

	if (!presentOptionNames.length)
		return undefined

	if (presentOptionNames.length > 1) {
		logError(`The options ${presentOptionNames.map(formatOption).join(`, `)
		} are aliases for each other. Please only specify one`)

		process.exit(1)
	}

	const value = options.get(presentOptionNames[0]!)!

	options.delete(presentOptionNames[0]!)

	return { name: presentOptionNames[0]!, value }
}

function complainAboutUnrecognisedOptions(): void {
	if (options.size) {
		logError(
			`Unrecognised option${options.size > 1 ? `s` : ``}: ${[ ...options.keys() ].map(formatOption).join(`, `)}`
		)

		process.exit(1)
	}
}
