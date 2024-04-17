#!/usr/bin/env node
import { Cache } from "@samual/lib/Cache"
import { assert } from "@samual/lib/assert"
import { countHackmudCharacters } from "@samual/lib/countHackmudCharacters"
import { writeFilePersistent } from "@samual/lib/writeFilePersistent"
import { mkdir as makeDirectory, readFile, rmdir as removeDirectory, writeFile } from "fs/promises"
import { homedir as getHomeDirectory } from "os"
import {
	basename as getPathBaseName,
	dirname as getPathDirectory,
	extname as getPathFileExtension,
	relative as getRelativePath,
	resolve as resolvePath
} from "path"
import type { Info } from ".."
import { version as moduleVersion } from "../../package.json"
import { supportedExtensions } from "../constants"
import generateTypeDeclaration from "../generateTypeDeclaration"
import pull from "../pull"
import syncMacros from "../syncMacros"

type ArgumentValue = boolean | number | string/* | ArgValue[]*/
type Config = Partial<{ hackmudPath: string }> & Record<string, unknown>

const configDirectoryPath = resolvePath(getHomeDirectory(), `.config`)
const configFilePath = resolvePath(configDirectoryPath, `hsm.json`)
const options = new Map<string, ArgumentValue>()
const commands: string[] = []

const userColours = new Cache<string, string>(user => {
	let hash = 0

	for (const char of user)
		hash += (hash >> 1) + hash + `xi1_8ratvsw9hlbgm02y5zpdcn7uekof463qj`.indexOf(char) + 1

	return [ colourJ, colourK, colourM, colourW, colourL, colourB ][hash % 6]!(user)
})

const logNeedHackmudPathMessage = () => console.error(colourS(`\
${colourD(`You need to set hackmudPath in config before you can use this command`)}

${colourA(`To fix this:`)}
Open hackmud and run "${colourC(`#dir`)}"
This will open a file browser and print your hackmud user's script directory
Go up 2 directories and then copy the path
Then in a terminal run "${colourC(`hsm`)} ${colourL(`config set`)} ${colourV(`hackmudPath`)} ${colourB(`<the path you copied>`)}"`
))

const logHelp = () => {
	const pushCommandDescription = `Push scripts from a directory to hackmud user's scripts directories`
	const watchCommandDescription = `Watch a directory and push a script when modified`
	const minifyCommandDescription = `Minify a script file on the spot`
	const generateTypeDeclarationCommandDescription = `Generate a type declaration file for a directory of scripts`
	const syncMacrosCommandDescription = `Sync macros across all hackmud users`
	const configCommandDescription = `Modify and view the config file`
	const configGetCommandDescription = `Retrieve a value from the config file`
	const configSetCommandDescription = `Assign a value to the config file`
	const configDeleteCommandDescription = `Remove a key and value from the config file`
	const pullCommandDescription = `Pull a script a from a hackmud user's script directory`

	const noMinifyOptionDescription = `Skip minification to produce a "readable" script`
	const mangleNamesOptionDescription = `Reduce character count further but lose function names in error call stacks`
	const forceQuineCheatsOptionDescription = `Force quine cheats on. Use ${colourN(`--force-quine-cheats`)}=${colourV(`false`)} to force off`

	console.log(colourN(`Version`) + colourS(`: `) + colourV(moduleVersion))

	switch (commands[0]) {
		case `config`: {
			switch (commands[1]) {
				case `get`: {
					console.log(`
${colourJ(configGetCommandDescription)}

${colourA(`Usage:`)}
${colourC(`hsm`)} ${colourL(`${commands[0]} ${commands[1]}`)} ${colourB(`<key>`)}`
					)
				} break

				case `set`: {
					console.log(`
${colourJ(configSetCommandDescription)}

${colourA(`Usage:`)}
${colourC(`hsm`)} ${colourL(`${commands[0]} ${commands[1]}`)} ${colourB(`<key> <value>`)}`
					)
				} break

				case `delete`: {
					console.log(`
${colourJ(configDeleteCommandDescription)}

${colourA(`Usage:`)}
${colourC(`hsm`)} ${colourL(`${commands[0]} ${commands[1]}`)} ${colourB(`<key>`)}`
					)
				} break

				default: {
					console.log(colourS(`\
${colourN(`Config path`)}: ${colourV(configFilePath)}

${colourJ(`Modify the config file`)}

${colourA(`Usage:`)}
${colourC(`hsm`)} ${colourL(`${commands[0]} get`)} ${colourB(`<key>`)}
    ${configGetCommandDescription}
${colourC(`hsm`)} ${colourL(`${commands[0]} set`)} ${colourB(`<key> <value>`)}
    ${configSetCommandDescription}
${colourC(`hsm`)} ${colourL(`${commands[0]} delete`)} ${colourB(`<key>`)}
    ${configDeleteCommandDescription}`
					))
				}
			}
		} break

		case `dev`:
		case `watch`:
		case `push`: {
			console.log(colourS(`
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
${colourN(`--force-quine-cheats`)}
    ${forceQuineCheatsOptionDescription}
${commands[0] == `push` ? `` : `${colourN(`--type-declaration-path`)}=${colourB(`<path>`)}
    Path to generate a type declaration file for the scripts
`}\

${colourA(`Examples:`)}
${colourC(`hsm`)} ${colourL(commands[0])} ${colourV(`src`)}
	Pushes all scripts found in ${colourV(`src`)} folder to all users
${colourC(`hsm`)} ${colourL(commands[0])} ${colourV(`src`)} ${colourC(`foo`)}${colourV(`.`)}${colourL(`bar`)}
    Pushes a script named ${colourL(`bar`)} found in ${colourV(`src`)} folder to user ${userColours.get(`foo`)}
${colourC(`hsm`)} ${colourL(commands[0])} ${colourV(`src`)} ${colourC(`foo`)}${colourV(`.`)}${colourL(`bar`)} ${colourC(`baz`)}${colourV(`.`)}${colourL(`qux`)}
    Multiple can be specified.
${colourC(`hsm`)} ${colourL(commands[0])} ${colourV(`src`)} ${colourC(`foo`)}${colourV(`.`)}${colourL(`*`)}
	Pushes all scripts found in ${colourV(`src`)} folder to user ${userColours.get(`foo`)}
${colourC(`hsm`)} ${colourL(commands[0])} ${colourV(`src`)} ${colourC(`*`)}${colourV(`.`)}${colourL(`foo`)}
	Pushes all scripts named ${colourL(`foo`)} found in ${colourV(`src`)} folder to all user
${colourC(`hsm`)} ${colourL(commands[0])} ${colourV(`src`)} ${colourC(`*`)}${colourV(`.`)}${colourL(`*`)}
	Pushes all scripts found in ${colourV(`src`)} folder to all users`
			))
		} break

		case `pull`: {
			console.log(colourS(`
${colourJ(pullCommandDescription)}

${colourA(`Usage:`)}
${colourC(`hsm`)} ${colourL(commands[0])} ${colourB(`<script user>`)}${colourV(`.`)}${colourB(`<script name>`)}`
			))
		} break

		case `minify`:
		case `golf`: {
			console.log(colourS(`
${colourJ(minifyCommandDescription)}

${colourA(`Usage:`)}
${colourC(`hsm`)} ${colourL(commands[0])} ${colourB(`<target> [output path]`)}

${colourA(`Options:`)}
${colourN(`--no-minify`)}
    ${noMinifyOptionDescription}
${colourN(`--mangle-names`)}
    ${mangleNamesOptionDescription}
${colourN(`--force-quine-cheats`)}
    ${forceQuineCheatsOptionDescription}
${colourN(`--watch`)}
    Watch for changes`
			))
		} break

		case `generate-type-declaration`:
		case `gen-type-declaration`:
		case `gen-dts`:
		case `gen-types`: {
			console.log(colourS(`\
${colourJ(generateTypeDeclarationCommandDescription)}

${colourA(`Usage:`)}
${colourC(`hsm`)} ${colourL(commands[0])} ${colourB(`<directory> [output path]`)}`
			))
		} break

		case `sync-macros`: {
			console.log(`\n${colourJ(syncMacrosCommandDescription)}`)
		} break

		default: {
			console.log(colourS(`
${colourJ(`Hackmud Script Manager`)}

${colourA(`Commands:`)}
${colourL(`push`)}
    ${pushCommandDescription}
${colourL(`dev`)}
    ${watchCommandDescription}
${colourL(`golf`)}
    ${minifyCommandDescription}
${colourL(`gen-dts`)}
    ${generateTypeDeclarationCommandDescription}
${colourL(`sync-macros`)}
    ${syncMacrosCommandDescription}
${colourL(`config`)}
    ${configCommandDescription}
${colourL(`pull`)}
    ${pullCommandDescription}`
			))
		}
	}
}

const exploreObject = (object: any, keys: string[], createPath = false) => {
	for (const key of keys) {
		if (createPath)
			object = typeof object[key] == `object` ? object[key] : object[key] = {}
		else
			object = object?.[key]
	}

	return object
}

const updateConfig = async (config: Config) => {
	const json = JSON.stringify(config, undefined, `\t`)

	if (configDidNotExist)
		log(`Creating config file at ${configFilePath}`)

	await writeFile(configFilePath, json).catch(async error => {
		switch (error.code) {
			case `EISDIR`: {
				await removeDirectory(configFilePath)
			} break

			case `ENOENT`: {
				await makeDirectory(configDirectoryPath)
			} break

			default:
				throw error
		}

		await writeFile(configFilePath, json)
	})
}

const logInfo = ({ file, users, minLength, error }: Info, hackmudPath: string) => {
	if (error) {
		logError(`error "${chalk.bold(error.message)}" in ${chalk.bold(file)}`)

		return
	}

	console.log(
		`pushed ${
			chalk.bold(file)
		} to ${
			users.map(user => chalk.bold(userColours.get(user))).join(`, `)
		} | ${
			chalk.bold(String(minLength))
		} chars | ${
			chalk.bold(
				`${resolvePath(
					hackmudPath!,
					users[0]!,
					`scripts`,
					getPathBaseName(file, getPathFileExtension(file))
				)}.js`
			)
		}`
	)
}

const log = (message: string) => {
	console.log(colourS(message))
}

const logError = (message: string) => {
	console.error(colourD(message))
	process.exitCode = 1
}

for (const argument of process.argv.slice(2)) {
	if (argument[0] == `-`) {
		const [ key, valueRaw ] = argument.split(`=`)
		let value: ArgumentValue | undefined = valueRaw

		if (value) {
			if (value == `true`)
				value = true
			else if (value == `false`)
				value = false
			else {
				const number = Number(value)

				if (isFinite(number))
					value = number
			}
		} else
			value = true

		if (argument[1] == `-`)
			options.set(key!.slice(2), value)
		else {
			for (const option of key!.slice(1))
				options.set(option, value)
		}
	} else
		commands.push(argument)
}

if (commands[0] == `v` || commands[0] == `version` || options.get(`version`) || options.get(`v`)) {
	console.log(moduleVersion)
	process.exit()
}

let configDidNotExist = false

const configPromise: Promise<Config> = readFile(configFilePath, { encoding: `utf-8` }).then(
	configFile => {
		let temporaryConfig

		try {
			temporaryConfig = JSON.parse(configFile)
		} catch {
			// TODO log to error log file
			log(`Config file was corrupted, resetting`)

			return {}
		}

		if (!temporaryConfig || typeof temporaryConfig != `object`) {
			log(`Config file was corrupted, resetting`)

			return {}
		}

		if (`hackmudPath` in temporaryConfig && typeof temporaryConfig.hackmudPath != `string`) {
			log(`Property "hackmudPath" of config file was corrupted, removing`)
			delete temporaryConfig.hackmudPath
		}

		return temporaryConfig
	},
	() => {
		configDidNotExist = true

		return {}
	}
)

const pushModule = import(`../push`)
const processScriptModule = import(`../processScript`)
const watchModule = import(`../watch`)
const chokidarModule = import(`chokidar`)

const { default: chalk } = await import(`chalk`)

const colourA = chalk.rgb(0xFF, 0xFF, 0xFF)
const colourB = chalk.rgb(0xCA, 0xCA, 0xCA)
const colourC = chalk.rgb(0x9B, 0x9B, 0x9B)
const colourD = chalk.rgb(0xFF, 0x00, 0x00)
const colourJ = chalk.rgb(0xFF, 0xF4, 0x04)
const colourK = chalk.rgb(0xF3, 0xF9, 0x98)
const colourL = chalk.rgb(0x1E, 0xFF, 0x00)
const colourM = chalk.rgb(0xB3, 0xFF, 0x9B)
const colourN = chalk.rgb(0x00, 0xFF, 0xFF)
const colourS = chalk.rgb(0x7A, 0xB2, 0xF4)
const colourV = chalk.rgb(0xFF, 0x00, 0xEC)
const colourW = chalk.rgb(0xFF, 0x96, 0xE0)

if (options.get(`help`) || options.get(`h`)) {
	logHelp()
	process.exit()
}

let autoExit = true

switch (commands[0]) {
	case `push`: {
		const { hackmudPath } = await configPromise

		if (!hackmudPath) {
			logNeedHackmudPathMessage()

			break
		}

		const sourcePath = commands[1]

		if (!sourcePath) {
			logError(`Must provide the directory to push from\n`)
			logHelp()

			break
		}

		const scripts = commands.slice(2)

		if (scripts.length) {
			const invalidScript = scripts
				.find(script => !/^(?:[a-z_][a-z\d_]{0,24}|\*)\.(?:[a-z_][a-z\d_]{0,24}|\*)$/.test(script))

			if (invalidScript) {
				logError(`Invalid script name: ${JSON.stringify(invalidScript)}\n`)
				logHelp()

				break
			}
		} else
			scripts.push(`*.*`)

		const optionsHasNoMinify = options.has(`no-minify`)

		if ((optionsHasNoMinify || options.has(`skip-minify`)) && options.has(`mangle-names`)) {
			logError(`Options ${colourN(`--mangle-names`)} and ${
				colourN(optionsHasNoMinify ? `--no-minify` : `--skip-minify`)
			} are incompatible\n`)

			logHelp()

			break
		}

		const shouldSkipMinify = options.get(`no-minify`) || options.get(`skip-minify`)
		let shouldMinify

		if (shouldSkipMinify != undefined) {
			if (typeof shouldSkipMinify != `boolean`) {
				logError(`The value for ${colourN(optionsHasNoMinify ? `--no-minify` : `--skip-minify`)} must be ${
					colourV(`true`)
				} or ${colourV(`false`)}\n`)

				logHelp()

				break
			}

			shouldMinify = !shouldSkipMinify
		}

		const shouldMangleNames = options.get(`mangle-names`)

		if (shouldMangleNames != undefined && typeof shouldMangleNames != `boolean`) {
			logError(`The value for ${colourN(`--mangle-names`)} must be ${colourV(`true`)} or ${colourV(`false`)}\n`)
			logHelp()

			break
		}

		const shouldforceQuineCheats = options.get(`force-quine-cheats`)

		if (shouldforceQuineCheats != undefined && typeof shouldforceQuineCheats != `boolean`) {
			logError(`The value for ${colourN(`--force-quine-cheats`)} must be ${colourV(`true`)} or ${colourV(`false`)}\n`)
			logHelp()

			break
		}

		const { push } = await pushModule

		const infos = await push(sourcePath, hackmudPath, {
			scripts,
			onPush: info => logInfo(info, hackmudPath),
			minify: shouldMinify,
			mangleNames: shouldMangleNames,
			forceQuineCheats: shouldforceQuineCheats
		})

		if (!infos.length)
			logError(`Could not find any scripts to push`)
	} break

	case `dev`:
	case `watch`: {
		const { hackmudPath } = await configPromise

		if (!hackmudPath) {
			logNeedHackmudPathMessage()

			break
		}

		const sourcePath = commands[1]

		if (!sourcePath) {
			logError(`Must provide the directory to watch\n`)
			logHelp()

			break
		}

		const scripts = commands.slice(2)

		if (scripts.length) {
			const invalidScript = scripts
				.find(script => !/^(?:[a-z_][a-z\d_]{0,24}|\*)\.(?:[a-z_][a-z\d_]{0,24}|\*)$/.test(script))

			if (invalidScript) {
				logError(`Invalid script name: ${JSON.stringify(invalidScript)}\n`)
				logHelp()

				break
			}
		} else
			scripts.push(`*.*`)

		const optionsHasNoMinify = options.has(`no-minify`)

		if ((optionsHasNoMinify || options.has(`skip-minify`)) && options.has(`mangle-names`)) {
			logError(`Options ${colourN(`--mangle-names`)} and ${
				colourN(optionsHasNoMinify ? `--no-minify` : `--skip-minify`)
			} are incompatible\n`)

			logHelp()

			break
		}

		const shouldSkipMinify = options.get(`no-minify`) || options.get(`skip-minify`)
		let shouldMinify

		if (shouldSkipMinify != undefined) {
			if (typeof shouldSkipMinify != `boolean`) {
				logError(`The value for ${colourN(optionsHasNoMinify ? `--no-minify` : `--skip-minify`)} must be ${
					colourV(`true`)
				} or ${colourV(`false`)}\n`)

				logHelp()

				break
			}

			shouldMinify = !shouldSkipMinify
		}

		const shouldMangleNames = options.get(`mangle-names`)

		if (shouldMangleNames != undefined && typeof shouldMangleNames != `boolean`) {
			logError(`The value for ${colourN(`--mangle-names`)} must be ${colourV(`true`)} or ${colourV(`false`)}\n`)
			logHelp()

			break
		}

		const shouldforceQuineCheats = options.get(`force-quine-cheats`)

		if (shouldforceQuineCheats != undefined && typeof shouldforceQuineCheats != `boolean`) {
			logError(`The value for ${colourN(`--force-quine-cheats`)} must be ${colourV(`true`)} or ${colourV(`false`)}\n`)
			logHelp()

			break
		}

		const { watch } = await watchModule

		watch(sourcePath, hackmudPath, {
			scripts,
			onPush: info => logInfo(info, hackmudPath),
			typeDeclarationPath: (options.get(`type-declaration-path`) || options.get(`type-declaration`) || options.get(`dts`) || options.get(`gen-types`))?.toString(),
			minify: shouldMinify,
			mangleNames: shouldMangleNames,
			onReady: () => log(`Watching`),
			forceQuineCheats: shouldforceQuineCheats
		})

		autoExit = false
	} break

	case `pull`: {
		const { hackmudPath } = await configPromise

		if (!hackmudPath) {
			logNeedHackmudPathMessage()

			break
		}

		const script = commands[1]

		if (!script) {
			logError(`Must provide the script to pull\n`)
			logHelp()

			break
		}

		const sourcePath = commands[2] || `.`

		try {
			await pull(sourcePath, hackmudPath, script)
		} catch (error) {
			console.error(error)
			logError(`Something went wrong, did you forget to ${colourC(`#down`)} the script?`)
		}
	} break

	case `sync-macros`: {
		const { hackmudPath } = await configPromise

		if (!hackmudPath) {
			logNeedHackmudPathMessage()

			break
		}

		const { macrosSynced, usersSynced } = await syncMacros(hackmudPath)

		log(`Synced ${macrosSynced} macros to ${usersSynced} users`)
	} break

	case `generate-type-declaration`:
	case `gen-type-declaration`:
	case `gen-dts`:
	case `gen-types`: {
		const target = commands[1]

		if (!target) {
			logError(`Must provide target directory\n`)
			logHelp()

			break
		}

		const sourcePath = resolvePath(target)
		const outputPath = commands[2] || `./player.d.ts`
		const typeDeclaration = await generateTypeDeclaration(sourcePath, (await configPromise).hackmudPath)
		let typeDeclarationPath = resolvePath(outputPath)

		try {
			await writeFile(typeDeclarationPath, typeDeclaration)
		} catch (error) {
			assert(error instanceof Error)

			if (!((error as NodeJS.ErrnoException).code == `EISDIR`))
				throw error

			typeDeclarationPath = resolvePath(typeDeclarationPath, `player.d.ts`)
			await writeFile(typeDeclarationPath, typeDeclaration)
		}

		log(`Wrote type declaration to ${chalk.bold(typeDeclarationPath)}`)
	} break

	case `config`: {
		switch (commands[1]) {
			case `get`: {
				const key = commands[2]

				if (key)
					log(exploreObject(await configPromise, key.split(`.`)))
				else
					console.log(await configPromise)
			} break

			case `delete`: {
				const key = commands[2]

				if (!key) {
					logError(`Must provide a key to delete\n`)
					logHelp()

					break
				}

				const keyParts = key.split(`.`)

				const pathName = keyParts
					.map(name => /^[a-z_$][\w$]*$/i.test(name) ? name : JSON.stringify(name))
					.join(`.`)

				const lastKey = keyParts.pop()!
				const config = await configPromise

				delete exploreObject(config, keyParts)?.[lastKey]
				log(`Removed ${colourV(pathName)} from config file`)
			} break

			case `set`: {
				const key = commands[2]
				const value = commands[3]

				if (!key) {
					logError(`Must provide a key and value\n`)
					logHelp()

					break
				}

				const keys = key.split(`.`)

				const pathName = keys
					.map(name => /^[a-z_$][\w$]*$/i.test(name) ? name : JSON.stringify(name))
					.join(`.`)

				if (!value) {
					logError(`Must provide a value for the key ${pathName}\n`)
					logHelp()

					break
				}

				const lastKey = keys.pop()!
				const config = await configPromise

				if (!keys.length && lastKey == `hackmudPath`)
					config.hackmudPath = resolvePath(value.startsWith(`~/`) ? getHomeDirectory() + value.slice(1) : value)
				else {
					let object: any = config

					for (const key of keys) {
						if (typeof object[key] == `object`)
							object = object[key]
						else {
							object[key] = {}
							object = object[key]
						}
					}

					object[lastKey] = value
				}

				console.log(config)
				await updateConfig(config)
			} break

			default: {
				if (commands[1])
					logError(`Unknown command: ${JSON.stringify(commands[1])}\n`)

				logHelp()
			}
		}
	} break

	case `help`:
	case `h`: {
		logHelp()
	} break

	case `golf`:
	case `minify`: {
		const target = commands[1]

		if (!target) {
			logError(`Must provide target\n`)
			logHelp()

			break
		}

		const fileExtension = getPathFileExtension(target)

		if (!supportedExtensions.includes(fileExtension)) {
			logError(`Unsupported file extension "${chalk.bold(fileExtension)}"\nSupported extensions are "${supportedExtensions.map(extension => chalk.bold(extension)).join(`", "`)}"`)

			break
		}

		const { processScript } = await processScriptModule
		const fileBaseName = getPathBaseName(target, fileExtension)
		// eslint-disable-next-line unicorn/prevent-abbreviations -- the file extension is `src` not `source`
		const fileBaseNameEndsWithDotSrc = fileBaseName.endsWith(`.src`)
		const scriptName = fileBaseNameEndsWithDotSrc ? fileBaseName.slice(0, -4) : fileBaseName

		const scriptUser = (
			getPathBaseName(resolvePath(target, `..`)) == `scripts` &&
			getPathBaseName(resolvePath(target, `../../..`)) == `hackmud`
		) ? getPathBaseName(resolvePath(target, `../..`)) : `UNKNOWN`

		const optionsHasNoMinify = options.has(`no-minify`)

		if ((optionsHasNoMinify || options.has(`skip-minify`)) && options.has(`mangle-names`)) {
			logError(`Options ${colourN(`--mangle-names`)} and ${
				colourN(optionsHasNoMinify ? `--no-minify` : `--skip-minify`)
			} are incompatible\n`)

			logHelp()

			break
		}

		const mangleNames_ = options.get(`mangle-names`)

		if (mangleNames_ != undefined && typeof mangleNames_ != `boolean`) {
			logError(`The value for ${colourN(`--mangle-names`)} must be ${colourV(`true`)} or ${colourV(`false`)}\n`)
			logHelp()

			break
		}

		const mangleNames = mangleNames_

		const forceQuineCheats_ = options.get(`force-quine-cheats`)

		if (forceQuineCheats_ != undefined && typeof forceQuineCheats_ != `boolean`) {
			logError(`the value for ${colourN(`--force-quine-cheats`)} must be ${colourV(`true`)} or ${colourV(`false`)}\n`)
			logHelp()

			break
		}

		const forceQuineCheats = forceQuineCheats_

		let outputPath = commands[2] || resolvePath(
			getPathDirectory(target),
			fileBaseNameEndsWithDotSrc
				? `${scriptName}.js`
				: (fileExtension == `.js` ? `${fileBaseName}.min.js` : `${fileBaseName}.js`)
		)

		const golfFile = () => readFile(target, { encoding: `utf-8` }).then(
			async source => {
				const timeStart = performance.now()

				const { script, warnings } = await processScript(source, {
					minify: !(options.get(`no-minify`) || options.get(`skip-minify`)),
					scriptUser,
					scriptName,
					filePath: target,
					mangleNames,
					forceQuineCheats
				})

				const timeTook = performance.now() - timeStart

				for (const { message, line } of warnings)
					log(`Warning "${chalk.bold(message)}" on line ${chalk.bold(String(line))}`)

				await writeFilePersistent(outputPath, script)
					.catch(async (error: NodeJS.ErrnoException) => {
						if (!commands[2] || error.code != `EISDIR`)
							throw error

						outputPath = resolvePath(outputPath, `${getPathBaseName(target, fileExtension)}.js`)
						await writeFilePersistent(outputPath, script)
					})
					.then(
						() => log(`Wrote ${chalk.bold(countHackmudCharacters(script))} chars to ${chalk.bold(getRelativePath(`.`, outputPath))} | took ${Math.round(timeTook * 100) / 100}ms`),
						(error: NodeJS.ErrnoException) => logError(error.message)
					)
			},
			(error: NodeJS.ErrnoException) => logError(error.message)
		)

		if (options.get(`watch`)) {
			const { watch: watchFile } = await chokidarModule

			watchFile(target, { awaitWriteFinish: { stabilityThreshold: 100 } })
				.on(`ready`, () => log(`Watching ${target}`))
				.on(`change`, golfFile)

			autoExit = false
		} else
			await golfFile()
	} break

	default: {
		if (commands[0])
			logError(`Unknown command: ${JSON.stringify(commands[0])}\n`)

		logHelp()
	}
}

if (autoExit)
	process.exit()
