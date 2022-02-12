#!/usr/bin/env node
import { countHackmudCharacters, DynamicMap, writeFilePersistent } from "@samual/lib"
import chalk from "chalk"
import { watch as watchFile } from "chokidar"
import fs from "fs"
import { homedir as getHomeDirectory } from "os"
import { basename as getPathBaseName, dirname as getPathDirectory, extname as getPathFileExtension, relative as getRelativePath, resolve as resolvePath } from "path"
import { generateTypings, Info, processScript, pull, push, syncMacros, watch } from ".."
import { version as moduleVersion } from "../../package.json"
import { supportedExtensions } from "../constants.json"

const { readFile, rmdir: removeDirectory, writeFile, mkdir: makeDirectory } = fs.promises

type ArgumentValue = boolean | number | string/* | ArgValue[]*/

const configDirectoryPath = resolvePath(getHomeDirectory(), `.config`)
const configFilePath = resolvePath(configDirectoryPath, `hsm.json`)

const options = new Map<string, ArgumentValue>()
const commands: string[] = []

let config: Record<string, any> & Partial<{
	hackmudPath: string
	defaultUser: string
	users: Record<string, {
		colour: string
	}>
}> | undefined

const colourJ = chalk.rgb(0xFF, 0xF4, 0x04)
const colourK = chalk.rgb(0xF3, 0xF9, 0x98)
const colourM = chalk.rgb(0xB3, 0xFF, 0x9B)
const colourW = chalk.rgb(0xFF, 0x96, 0xE0)
const colourL = chalk.rgb(0x1E, 0xFF, 0x00)
const colourB = chalk.rgb(0xCA, 0xCA, 0xCA)

const userColours = new DynamicMap<string, string>(user => {
	let hash = 0

	for (const char of user)
		hash += (hash >> 1) + hash + `xi1_8ratvsw9hlbgm02y5zpdcn7uekof463qj`.indexOf(char) + 1

	return [ colourJ, colourK, colourM, colourW, colourL, colourB ][hash % 6]!(user)
})

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

(async () => {
	if (options.get(`version`) || options.get(`v`)) {
		version()

		return
	}

	if (options.get(`help`) || options.get(`h`)) {
		help()

		return
	}

	switch (commands[0]) {
		case `push`: {
			const config = await getConfig()

			if (!config.hackmudPath) {
				console.log(`you need to set hackmudPath in config before you can use this command`)

				break
			}

			const sourcePath = commands[1] || `.`
			const hackmudPath = config.hackmudPath
			const scripts = commands.slice(2)

			if (!scripts.length)
				scripts.push(`*.*`)

			const infos = await push(
				sourcePath,
				hackmudPath,
				{
					scripts,
					onPush: onPushLogger,
					minify: !options.get(`skip-minify`)
				}
			)

			if (!infos.length)
				console.warn(`couldn't find any scripts to push`)

			updateConfig()
		} break

		case `dev`:
		case `watch`: {
			if (!commands[1]) {
				console.error(`specify the directory to watch`)
				help()

				break
			}

			const config = await getConfig()

			if (!config.hackmudPath) {
				console.log(`you need to set hackmudPath in config before you can use this command`)

				break
			}

			const scripts = commands.slice(2)

			if (!scripts.length)
				scripts.push(`*.*`)

			if (options.has(`skip-minify`) && options.has(`mangle-names`))
				console.warn(`pointless specifying both --skip-minify and --mangle-names`)

			watch(commands[1], config.hackmudPath, {
				scripts,
				onPush: onPushLogger,
				typeDeclarationPath: options.get(`type-declaration-path`)?.toString(),
				minify: !options.get(`skip-minify`),
				mangleNames: Boolean(options.get(`mangle-names`))
			})
		} break

		case `pull`: {
			const config = await getConfig()

			if (!config.hackmudPath) {
				console.log(`you need to set hackmudPath in config before you can use this command`)

				break
			}

			const script = commands[1]

			if (!script) {
				help()

				break
			}

			const sourcePath = commands[2] || `.`
			const hackmudPath = config.hackmudPath

			try {
				await pull(sourcePath, hackmudPath, script)
			} catch {
				console.log(`something went wrong, did you forget to #down the script?`)
			}
		} break

		case `sync-macros`: {
			const { hackmudPath } = await getConfig()

			if (!hackmudPath) {
				console.log(`you need to set hackmudPath in config before you can use this command`)

				break
			}

			const { macrosSynced, usersSynced } = await syncMacros(hackmudPath)

			console.log(`synced ${macrosSynced} macros to ${usersSynced} users`)
		} break

		case `gen-types`: {
			const sourcePath = resolvePath(commands[1] || `.`)

			generateTypings(
				sourcePath,
				commands[2]
					? resolvePath(commands[2])
					: resolvePath(sourcePath, `../player.d.ts`),
				(await getConfig()).hackmudPath
			)
		} break

		case `config`: {
			switch (commands[1]) {
				case `get`: {
					if (commands[2])
						console.log(exploreObject(await getConfig(), commands[2].split(`.`)))
					else
						console.log(await getConfig())
				} break

				case `delete`: {
					if (commands[2]) {
						const keys = commands[2].split(`.`)
						const lastKey = keys.pop()!

						if (!keys.length) {
							help()

							break
						}

						const config = await getConfig()

						delete exploreObject(config, keys)?.[lastKey]
						console.log(config)
					} else
						console.log(`Usage:\nhsm config delete <key>`)
				} break

				case `set`: {
					if (commands[2] && commands[3]) {
						const keys = commands[2].split(`.`)

						if (!keys.length) {
							help()

							break
						}

						const lastKey = keys.pop()!
						const config = await getConfig()

						if (!keys.length && lastKey == `hackmudPath`)
							config.hackmudPath = resolvePath(commands[3])
						else {
							let object = config

							for (const key of keys) {
								if (typeof object[key] == `object`)
									object = object[key]
								else {
									object[key] = {}
									object = object[key]
								}
							}

							object[lastKey] = commands[3]
						}

						console.log(config)
					} else
						console.log(`Usage:\nhsm config set <key> <value>`)
				} break

				default: {
					if (commands[1])
						console.log(`unknown command`)

					help()
				}
			}
		} break

		case `help`:
		case `h`: {
			help()
		} break

		case `version`:
		case `v`: {
			version()
		} break

		case `golf`:
		case `minify`: {
			const target = commands[1]

			if (!target) {
				console.log(`Target required\nUsage: ${getPathBaseName(process.argv[1]!)} ${commands[0]} <target> [output]`)

				break
			}

			const fileExtension = getPathFileExtension(target)

			if (!supportedExtensions.includes(fileExtension)) {
				console.log(`Unsupported file extension "${chalk.bold(fileExtension)}"\nSupported extensions are "${supportedExtensions.map(extension => chalk.bold(extension)).join(`", "`)}"`)

				break
			}

			if (options.get(`watch`)) {
				watchFile(target, { awaitWriteFinish: { stabilityThreshold: 100 } })
					.on(`ready`, () => console.log(`watching ${target}`))
					.on(`change`, () => golfFile(target, fileExtension))
			} else
				await golfFile(target, fileExtension)
		} break

		default: {
			if (commands[0])
				console.log(`unknown command`)

			help()
		}
	}

	updateConfig()

	async function golfFile(target: string, fileExtension: string) {
		await readFile(target, { encoding: `utf-8` }).then(
			async source => {
				const fileBaseName = getPathBaseName(target, fileExtension)
				// eslint-disable-next-line unicorn/prevent-abbreviations -- the file extension is `src` not `source`
				const fileBaseNameEndsWithDotSrc = fileBaseName.endsWith(`.src`)

				const scriptName = fileBaseNameEndsWithDotSrc
					? fileBaseName.slice(0, -4)
					: fileBaseName

				let scriptUser = `UNKNOWN`

				if (getPathBaseName(resolvePath(target, `..`)) == `scripts` && getPathBaseName(resolvePath(target, `../../..`)) == `hackmud`)
					scriptUser = getPathBaseName(resolvePath(target, `../..`))

				const minify = !options.get(`skip-minify`)
				const mangleNames = Boolean(options.get(`mangle-names`))

				if (!minify && mangleNames)
					console.warn(`warning: \`--mangle-names\` has no effect while \`--skip-minify\` is active`)

				const { script, srcLength, warnings, timeTook } = await processScript(
					source,
					{
						minify,
						scriptUser,
						scriptName,
						filePath: target,
						mangleNames
					}
				)

				for (const { message, line } of warnings)
					console.log(`warning "${chalk.bold(message)}" on line ${chalk.bold(String(line))}`)

				let outputPath: string

				outputPath = commands[2] ? commands[2] : resolvePath(
					getPathDirectory(target),

					fileBaseNameEndsWithDotSrc
						? `${scriptName}.js`
						: (fileExtension == `.js`
							? `${fileBaseName}.min.js`
							: `${fileBaseName}.js`
						)
				)

				const scriptLength = countHackmudCharacters(script)

				await writeFilePersistent(outputPath, script)
					.catch(async (error: NodeJS.ErrnoException) => {
						if (!commands[2] || error.code != `EISDIR`)
							throw error

						outputPath = resolvePath(outputPath, `${getPathBaseName(target, fileExtension)}.js`)
						await writeFilePersistent(outputPath, script)
					})
					.then(
						() => console.log(`wrote ${chalk.bold(scriptLength)} chars to ${chalk.bold(getRelativePath(`.`, outputPath))} | saved ${chalk.bold(srcLength - scriptLength)} chars | took ${Math.round(timeTook * 100) / 100}ms`),
						(error: NodeJS.ErrnoException) => console.log(error.message)
					)
			},
			(error: NodeJS.ErrnoException) => console.log(error.message)
		)
	}
})()

function help() {
	switch (commands[0]) {
		case `config`: {
			switch (commands[1]) {
				case `get`: {
					console.log(`hsm config get <key>`)
				} break

				case `set`: {
					console.log(`hsm config set <key> <value>`)
				} break

				case `delete`: {
					console.log(`hsm config delete <key>`)
				} break

				default: {
					console.log(`hsm config <get, delete, set>`)
				}
			}
		} break

		case `push`: {
			console.log(`hsm push [<dir> [..."<script user>.<script name>"]]`)
		} break

		case `dev`:
		case `watch`: {
			console.log(`hsm ${commands[0]} <dir> [..."<script user>.<script name>"] [--skip-minify] [--mangle-names]`)
		} break

		case `pull`: {
			console.log(`hsm pull <script user>.<script name>`)
		} break

		case `minify`:
		case `golf`: {
			console.log(`${getPathBaseName(process.argv[1]!)} ${commands[0]} <target> [output]`)
		} break

		default: {
			console.log(`hsm <push, watch, pull, config, golf>`)
		}
	}
}

function version() {
	console.log(moduleVersion)
}

async function getConfig() {
	if (config)
		return config

	return config = await readFile(configFilePath, { encoding: `utf-8` })
		.then(configFile => {
			let temporaryConfig

			try {
				temporaryConfig = JSON.parse(configFile)
			} catch {
				// TODO log to error log file
				console.log(`config file was corrupted, resetting`)

				return {}
			}

			if (!temporaryConfig || typeof temporaryConfig != `object`) {
				console.log(`config file was corrupted, resetting`)

				return {}
			}

			return temporaryConfig
		}, () => {
			console.log(`creating config file at ${configFilePath}`)

			return {}
		})
}

function exploreObject(object: any, keys: string[], createPath = false) {
	for (const key of keys) {
		if (createPath)
			object = typeof object[key] == `object` ? object[key] : object[key] = {}
		else
			object = object?.[key]
	}

	return object
}

function updateConfig() {
	if (config) {
		const json = JSON.stringify(config, undefined, `\t`)

		writeFile(configFilePath, json).catch(async error => {
			switch (error.code) {
				case `EISDIR`: {
					await removeDirectory(configFilePath)
				} break

				case `ENOENT`: {
					await makeDirectory(configDirectoryPath)
				} break

				default: {
					throw error
				}
			}

			writeFile(configFilePath, json)
		})
	}
}

function onPushLogger({ file, users, srcLength, minLength, error }: Info) {
	if (error) {
		console.log(`error "${chalk.bold(error.message)}" in ${chalk.bold(file)}`)

		return
	}

	console.log(
		`pushed ${
			chalk.bold(file)
		} to ${
			users.map(user => chalk.bold(userColours.get(user))).join(`, `)
		} | ${
			chalk.bold(String(minLength))
		} chars from ${
			chalk.bold(String(srcLength))
		} | saved ${
			chalk.bold(String(srcLength - minLength))
		} (${
			chalk.bold(`${Math.round((1 - (minLength / srcLength)) * 100)}%`)
		}) | ${
			chalk.bold(`${resolvePath(config!.hackmudPath!, users[0]!, `scripts`, getPathBaseName(file, getPathFileExtension(file)))}.js`)
		}`
	)
}
