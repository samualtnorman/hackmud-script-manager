#!/usr/bin/env node
import { basename as getBaseName, dirname as getPathDirectory, extname as getFileExtension, resolve as resolvePath } from "path"
import { homedir as getHomeDirectory } from "os"
import chalk from "chalk"
import fs from "fs"

import { generateTypings, processScript, pull, push, supportedExtensions, syncMacros, test, watch } from ".."
import { assert, catchError, DynamicMap, hackmudLength, writeFilePersist } from "../lib"

const { readFile: readFile, rmdir: removeDirectory, writeFile: writeFile, mkdir: makeDirectory } = fs.promises

type ArgValue = boolean | number | string/* | ArgValue[]*/

const configDirPath = resolvePath(getHomeDirectory(), ".config")
const configFilePath = resolvePath(configDirPath, "hsm.json")

const options = new Map<string, ArgValue>()
const commands: string[] = []

let config: Record<string, any> &  Partial<{
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
		hash += (hash >> 1) + hash + "xi1_8ratvsw9hlbgm02y5zpdcn7uekof463qj".indexOf(char) + 1

	return [ colourJ, colourK, colourM, colourW, colourL, colourB ][hash % 6](user)
})

for (const arg of process.argv.slice(2)) {
	if (arg[0] == "-") {
		const [ key, valueRaw ] = arg.split("=")
		let value: ArgValue = valueRaw

		if (value) {
			if (value == "true")
				value = true
			else if (value == "false")
				value = false
			else {
				const number = Number(value)

				if (isFinite(number))
					value = number
			}
		} else
			value = true

		if (arg[1] == "-")
			options.set(key.slice(2), value)
		else {
			for (const option of key.slice(1))
				options.set(option, value)
		}
	} else
		commands.push(arg)
}

(async () => {
	if (options.get("version") || options.get("v"))
		version()
	else if (options.get("help") || options.get("h"))
		help()
	else {
		switch (commands[0]) {
			case "push": {
				const config = await getConfig()

				if (config.hackmudPath) {
					const srcPath = commands[1] || "."
					const hackmudPath = config.hackmudPath
					const users = options.get("users")?.toString().split(",") || []
					const scripts = options.get("scripts")?.toString().split(",") || []

					await push(
						srcPath,
						hackmudPath,
						users,
						scripts,
						({ file, users, error, minLength, srcLength }) => users.length && console.log(
							error
								? `error "${
									error instanceof Error
										? chalk.bold(error.message)
										: error
								}" in ${chalk.dim(file)}`
								: `pushed ${chalk.bold(file)} to ${
									users.map(user =>
										chalk.bold(userColours.get(user))
									).join(", ")
								} | ${chalk.bold(String(minLength))} chars from ${chalk.bold(String(srcLength))} | saved ${chalk.bold(String(srcLength - minLength))} (${chalk.bold(`${Math.round((1 - (minLength / srcLength)) * 100)}%`)}) | ${chalk.bold(`${resolvePath(hackmudPath, users[0], "scripts", getBaseName(file, getFileExtension(file)))}.js`)}`
						)
					)

					updateConfig()
				} else
					console.log("you need to set hackmudPath in config before you can use this command")
			} break

			case "watch": {
				const config = await getConfig()

				if (config.hackmudPath) {
					const srcPath = commands[1] || "."
					const hackmudPath = config.hackmudPath
					const users = options.get("users")?.toString().split(",") || []
					const scripts = options.get("scripts")?.toString().split(",") || []
					const genTypes = options.get("gen-types")?.toString()

					watch(
						srcPath,
						hackmudPath,
						users,
						scripts,
						({ file, users, error, minLength, srcLength }) => users.length && console.log(
							error
								? `error "${
									error instanceof Error
										? chalk.bold(error.message)
										: error
								}" in ${chalk.dim(file)}`
								: `pushed ${chalk.bold(file)} to ${
									users.map(user =>
										chalk.bold(userColours.get(user))
									).join(", ")
								} | ${chalk.bold(String(minLength))} chars from ${chalk.bold(String(srcLength))} | saved ${chalk.bold(String(srcLength - minLength))} (${chalk.bold(`${Math.round((1 - (minLength / srcLength)) * 100)}%`)}) | ${chalk.bold(`${resolvePath(hackmudPath, users[0], "scripts", getBaseName(file, getFileExtension(file)))}.js`)}`
						),
						{ genTypes }
					)
				} else
					console.log("you need to set hackmudPath in config before you can use this command")
			} break

			case "pull": {
				const config = await getConfig()

				if (config.hackmudPath) {
					const script = commands[1]

					if (script) {
						const srcPath = commands[2] || "."
						const hackmudPath = config.hackmudPath

						try {
							await pull(srcPath, hackmudPath, script)
						} catch (error) {
							console.log("something went wrong, did you forget to #down the script?")
						}
					} else
						help()
				} else
					console.log("you need to set hackmudPath in config before you can use this command")
			} break

			case "sync-macros": {
				const { hackmudPath } = await getConfig()

				if (hackmudPath) {
					const { macrosSynced, usersSynced } = await syncMacros(hackmudPath)
					console.log(`synced ${macrosSynced} macros to ${usersSynced} users`)
				} else
					console.log("you need to set hackmudPath in config before you can use this command")
			} break

			case "test": {
				const srcPath = resolvePath(commands[1] || ".")
				let errors = 0

				console.log(`testing scripts in ${chalk.bold(srcPath)}\n`)

				for (const { file, line, message } of await test(srcPath)) {
					console.log(`error "${chalk.bold(message)}" in ${chalk.bold(file)} on line ${chalk.bold(String(line))}`)
					errors++
				}

				if (errors) {
					process.exitCode = 1
					console.log(`\nencountered ${chalk.bold(String(errors))} errors`)
				} else
					console.log("no errors found")
			} break

			case "gen-types": {
				const srcPath = resolvePath(commands[1] || ".")
				let targetPath: string

				if (commands[2])
					targetPath = resolvePath(commands[2])
				else
					targetPath = resolvePath(srcPath, "../player.d.ts")

				generateTypings(srcPath, targetPath, (await getConfig()).hackmudPath)

				break
			}

			case "config":
				switch (commands[1]) {
					case "get": {
						console.log(exploreObject(await getConfig(), commands.slice(2)))
					} break

					case "delete": {
						const config = await getConfig()
						const keys = commands.slice(2)

						if (keys.length) {
							delete exploreObject(config, keys.slice(0, -1))?.[keys.slice(-1)[0]]
							console.log(config)
						} else
							help()
					} break

					case "set": {
						const config = await getConfig()
						const keys = commands.slice(2)
						const value = keys.pop()

						if (keys.length) {
							let object = config

							for (let key of keys.slice(0, -1))
								object = typeof object[key] == "object" ? object[key] : object[key] = {}

							object[keys.slice(-1)[0]] = value

							if (config.hackmudPath)
								config.hackmudPath = resolvePath(config.hackmudPath)

							console.log(config)
						} else
							help()

						break
					}

					default: {
						if (commands[1])
							console.log("unknown command")

						help()
					}
				} break

			case "help":
			case "h": {
				help()
			} break

			case "version":
			case "v": {
				version()
			} break

			case "golf":
			case "minify": {
				if (!commands[1]) {
					console.log(`Target required\nUsage: ${getBaseName(process.argv[1])} ${commands[0]} <target> [output]`)
					break
				}

				const fileExtension = getFileExtension(commands[1])

				if (!supportedExtensions.includes(fileExtension)) {
					console.log(`Unsupported file extension "${chalk.bold(fileExtension)}"\nSupported extensions are "${supportedExtensions.map(chalk.bold).join('", "')}"`)
					break
				}

				const source = await catchError(readFile(commands[1], { encoding: "utf-8" }))

				if (source instanceof Error) {
					assert(source )
					break
				}

				const { script, srcLength, warnings } = await processScript(source)

				for (const { message, line } of warnings)
					console.log(`warning "${chalk.bold(message)}" on line ${chalk.bold(String(line))}`)

				let outputPath: string

				if (commands[2])
					outputPath = commands[2]
				else {
					const fileBaseName = getBaseName(commands[1], fileExtension)

					outputPath = resolvePath(
						getPathDirectory(commands[1]),

						fileBaseName.endsWith(".src")
							? `${fileBaseName.slice(0, -4)}.js` :
						fileExtension == ".js"
							? `${fileBaseName}.min.js`
							: `${fileBaseName}.js`
					)
				}

				await writeFilePersist(resolvePath(getPathDirectory(commands[1])), script)

				console.log(`wrote ${chalk.bold(String(hackmudLength(script)))} chars (from ${chalk.bold(String(srcLength))} chars) to ${chalk.bold(outputPath)}`)
			} break

			default: {
				if (commands[0])
					console.log("unknown command")

				help()
			}
		}
	}

	updateConfig()
})()

function help() {
	switch (commands[0]) {
		case "config": {
			switch (commands[1]) {
				case "get": {
					console.log("hsm config get <key>")
				} break

				case "set": {
					console.log("hsm config set <key> <value>")
				} break

				case "delete": {
					console.log("hsm config delete <key>")
				} break

				default: {
					console.log("hsm config <get, delete, set>")
				}
			}
		} break

		case "push": {
			console.log("hsm push [dir]")
		} break

		case "watch": {
			console.log("hsm watch [dir]")
		} break

		case "pull": {
			console.log("hsm pull <user.script>")
		} break

		case "minify":
		case "golf": {
			console.log(`${getBaseName(process.argv[1])} ${commands[0]} <target> [output]`)
		} break

		default: {
			console.log("hsm <push, watch, pull, config, golf>")
		}
	}
}

async function version() {
	console.log(JSON.parse(await readFile(resolvePath(__dirname, "../package.json"), { encoding: "utf-8" })).version || "unknown")
}

async function getConfig() {
	if (config)
		return config

	return config = await readFile(configFilePath, { encoding: "utf-8" })
		.then(configFile => {
			let tempConfig

			try {
				tempConfig = JSON.parse(configFile)
			} catch {
				// TODO log to error log file
				console.log("config file was corrupted, resetting")
				return {}
			}

			if (!tempConfig || typeof tempConfig != "object") {
				console.log("config file was corrupted, resetting")
				return {}
			}

			return tempConfig
		}, () => {
			console.log(`creating config file at ${configFilePath}`)
			return {}
		})
}

function exploreObject(object: any, keys: string[], createPath = false) {
	for (const key of keys) {
		if (createPath)
			object = typeof object[key] == "object" ? object[key] : object[key] = {}
		else
			object = object?.[key]
	}

	return object
}

function updateConfig() {
	if (config) {
		const json = JSON.stringify(config)

		writeFile(configFilePath, json).catch(async error => {
			switch (error.code) {
				case "EISDIR": {
					await removeDirectory(configFilePath)
				} break

				case "ENOENT": {
					await makeDirectory(configDirPath)
				} break

				default: {
					throw error
				}
			}

			writeFile(configFilePath, json)
		})
	}
}
