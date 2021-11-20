#!/usr/bin/env node
import { countHackmudCharacters, DynamicMap, writeFilePersistent } from "@samual/lib"
import chalk from "chalk"
import fs from "fs"
import { homedir as getHomeDirectory } from "os"
import { basename as getBaseName, dirname as getPathDirectory, extname as getFileExtension, relative as relativePath, resolve as resolvePath } from "path"
import { generateTypings, Info, processScript, pull, push, supportedExtensions, syncMacros, test, watch } from ".."
import { version as moduleVersion } from "../../package.json"

const { readFile, rmdir: removeDirectory, writeFile, mkdir: makeDirectory } = fs.promises

type ArgValue = boolean | number | string/* | ArgValue[]*/

const configDirPath = resolvePath(getHomeDirectory(), ".config")
const configFilePath = resolvePath(configDirPath, "hsm.json")

const options = new Map<string, ArgValue>()
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
	if (options.get("version") || options.get("v")) {
		version()
		return
	}

	if (options.get("help") || options.get("h")) {
		help()
		return
	}

	switch (commands[0]) {
		case "push": {
			const config = await getConfig()

			if (!config.hackmudPath) {
				console.log("you need to set hackmudPath in config before you can use this command")
				break
			}

			const srcPath = commands[1] || "."
			const hackmudPath = config.hackmudPath
			const scripts = commands.slice(2)

			if (!scripts.length)
				scripts.push("*.*")

			const infos = await push(
				srcPath,
				hackmudPath,
				{
					scripts,
					onPush: onPushLogger,
					minify: !options.get("skip-minify")
				}
			)

			if (!infos.length)
				console.warn("couldn't find any scripts to push")

			updateConfig()
		} break

		case "dev":
		case "watch": {
			const config = await getConfig()

			if (!config.hackmudPath) {
				console.log("you need to set hackmudPath in config before you can use this command")
				break
			}

			const srcPath = commands[1] || "."
			const hackmudPath = config.hackmudPath
			const users = options.get("users")?.toString().split(",") || []
			const scripts = options.get("scripts")?.toString().split(",") || []
			const genTypes = options.get("gen-types")?.toString()

			watch(srcPath, hackmudPath, users, scripts, onPushLogger, { genTypes })
		} break

		case "pull": {
			const config = await getConfig()

			if (!config.hackmudPath) {
				console.log("you need to set hackmudPath in config before you can use this command")
				break
			}

			const script = commands[1]

			if (!script) {
				help()
				break
			}

			const srcPath = commands[2] || "."
			const hackmudPath = config.hackmudPath

			try {
				await pull(srcPath, hackmudPath, script)
			} catch (error) {
				console.log("something went wrong, did you forget to #down the script?")
			}
		} break

		case "sync-macros": {
			const { hackmudPath } = await getConfig()

			if (!hackmudPath) {
				console.log("you need to set hackmudPath in config before you can use this command")
				break
			}

			const { macrosSynced, usersSynced } = await syncMacros(hackmudPath)
			console.log(`synced ${macrosSynced} macros to ${usersSynced} users`)
		} break

		case "test": {
			const srcPath = resolvePath(commands[1] || ".")
			let errors = 0

			console.log(`testing scripts in ${chalk.bold(srcPath)}\n`)

			for (const { file, line, message } of await test(srcPath)) {
				console.log(`error "${chalk.bold(message)}" in ${chalk.bold(file)} on line ${chalk.bold(String(line))}`)
				errors++
			}

			if (!errors) {
				console.log("no errors found")
				break
			}

			if (errors) {
				process.exitCode = 1
				console.log(`\nencountered ${chalk.bold(String(errors))} errors`)
				break
			}

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
		} break

		case "config":
			switch (commands[1]) {
				case "get": {
					console.log(exploreObject(await getConfig(), commands[2].split(".")))
				} break

				case "delete": {
					const keys = commands[2].split(".")

					if (!keys.length) {
						help()
						break
					}

					const config = await getConfig()

					delete exploreObject(config, keys)?.[commands[3]]

					console.log(config)
				} break

				case "set": {
					const keys = commands[2].split(".")

					if (!keys.length) {
						help()
						break
					}

					const config = await getConfig()
					let object = config

					for (let key of keys.slice(0, -1))
						object = typeof object[key] == "object" ? object[key] : object[key] = {}

					object[keys.slice(-1)[0]] = commands[3]

					if (config.hackmudPath)
						config.hackmudPath = resolvePath(config.hackmudPath)

					console.log(config)
				} break

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
			// TODO `--watch` option

			if (!commands[1]) {
				console.log(`Target required\nUsage: ${getBaseName(process.argv[1])} ${commands[0]} <target> [output]`)
				break
			}

			const fileExtension = getFileExtension(commands[1])

			if (!supportedExtensions.includes(fileExtension)) {
				console.log(`Unsupported file extension "${chalk.bold(fileExtension)}"\nSupported extensions are "${supportedExtensions.map(extension => chalk.bold(extension)).join('", "')}"`)
				break
			}

			await readFile(commands[1], { encoding: "utf-8" }).then(
				async source => {
					const fileBaseName = getBaseName(commands[1], fileExtension)
					const fileBaseNameEndsWithDotSrc = fileBaseName.endsWith(".src")

					const scriptName = fileBaseNameEndsWithDotSrc
						? fileBaseName.slice(0, -4)
						: fileBaseName

					let scriptUser = "UNKNOWN"

					if (getBaseName(resolvePath(commands[1], "..")) == "scripts" && getBaseName(resolvePath(commands[1], "../../..")) == "hackmud")
						scriptUser = getBaseName(resolvePath(commands[1], "../.."))

					const minify = !options.get("skip-minify")
					const mangleNames = Boolean(options.get("mangle-names"))

					if (!minify && mangleNames)
						console.warn("warning: `--mangle-names` has no effect while `--skip-minify` is active")

					const { script, srcLength, warnings, timeTook } = await processScript(
						source,
						{
							minify,
							scriptUser,
							scriptName,
							filePath: commands[1],
							mangleNames
						}
					)

					for (const { message, line } of warnings)
						console.log(`warning "${chalk.bold(message)}" on line ${chalk.bold(String(line))}`)

					let outputPath: string

					if (commands[2])
						outputPath = commands[2]
					else {
						outputPath = resolvePath(
							getPathDirectory(commands[1]),

							fileBaseNameEndsWithDotSrc
								? `${scriptName}.js` :
							fileExtension == ".js"
								? `${fileBaseName}.min.js`
								: `${fileBaseName}.js`
						)
					}

					const scriptLength = countHackmudCharacters(script)

					await writeFilePersistent(outputPath, script)
						.catch(async (error: NodeJS.ErrnoException) => {
							if (!commands[2] || error.code != "EISDIR")
								throw error

							outputPath = resolvePath(outputPath, `${getBaseName(commands[1], fileExtension)}.js`)

							await writeFilePersistent(outputPath, script)
						})
						.then(
							() => console.log(`wrote ${chalk.bold(scriptLength)} chars to ${chalk.bold(relativePath(".", outputPath))} | saved ${chalk.bold(srcLength - scriptLength)} chars | took ${Math.round(timeTook * 100) / 100}ms`),
							(error: NodeJS.ErrnoException) => console.log(error.message)
						)
				},
				(error: NodeJS.ErrnoException) => console.log(error.message)
			)
		} break

		default: {
			if (commands[0])
				console.log("unknown command")

			help()
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
			console.log("hsm push [<dir> [...\"<script user>.<script name>\"]]")
		} break

		case "watch": {
			console.log("hsm watch [dir]")
		} break

		case "pull": {
			console.log("hsm pull <script user>.<script name>")
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
	console.log(moduleVersion)
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

function onPushLogger({ file, users, srcLength, minLength, error }: Info) {
	if (!users.length)
		return

	if (error) {
		console.log(`error "${chalk.bold(error.message)}" in ${chalk.bold(file)}`)
		return
	}

	console.log(
		`pushed ${
			chalk.bold(file)
		} to ${
			users.map(user => chalk.bold(userColours.get(user))).join(", ")
		} | ${
			chalk.bold(String(minLength))
		} chars from ${
			chalk.bold(String(srcLength))
		} | saved ${
			chalk.bold(String(srcLength - minLength))
		} (${
			chalk.bold(`${Math.round((1 - (minLength / srcLength)) * 100)}%`)
		}) | ${
			chalk.bold(`${resolvePath(config!.hackmudPath!, users[0], "scripts", getBaseName(file, getFileExtension(file)))}.js`)
		}`
	)
}
