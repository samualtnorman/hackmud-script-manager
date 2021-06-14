#!/usr/bin/env node
import { readFile, mkdir as mkDir, writeFile, rmdir as rmDir } from "fs/promises"
import { basename, extname, resolve as resolvePath } from "path"
import { homedir as homeDir } from "os"
import { generateTypings, pull, push, syncMacros, test, watch } from ".."
import { redBright, yellowBright, greenBright, blueBright, cyanBright, magentaBright, bold, dim } from "ansi-colors"

// let o = ""

// for (let key in c) {
// 	if (![ "alias", "theme", "define", "create", "hasAnsi", "hasColor", "unstyle", "noop", "noop", "clear", "none", "stripColor", "reset", "gray" ].includes(key)) {
// 		const value: any = c[key]

// 		if (typeof value == "function")
// 			o += value(key) + " "
// 	}
// }

// console.log(o)

// console.log(c.redBright("test"), c.redBright.dim("test"), c.red("test"), c.red.dim("test"))

type ArgValue = boolean | number | string/* | ArgValue[]*/

const configDirPath = resolvePath(homeDir(), ".config")
const configFilePath = resolvePath(configDirPath, "hsm.json")

const options = new Map<string, ArgValue>()
const commands: string[] = []

// const helpConfig = {
// 	config: {
// 		set: [ "key", "value" ]
// 	}
// }

let config: Record<string, any> &  Partial<{
	hackmudPath: string
	defaultUser: string
	users: Record<string, {
		colour: string
	}>
}> | undefined

for (let arg of process.argv.slice(2)) {
	if (arg[0] == "-") {
		let [ key, valueRaw ] = arg.split("=")
		let value: ArgValue = valueRaw

		if (value)
			if (value == "true")
				value = true
			else if (value == "false")
				value = false
			else {
				let number = Number(value)

				if (isFinite(number))
					value = number
			}
		else
			value = true

		if (arg[1] == "-")
			options.set(key.slice(2), value)
		else
			for (let option of key.slice(1))
				options.set(option, value)
	} else
		commands.push(arg)
}

(async () => {
	if (options.get("version") || options.get("v"))
		version()
	else if (options.get("help") || options.get("h"))
		help()
	else
		switch (commands[0]) {
			case "push": {
				const config = await getConfig()

				if (config.hackmudPath) {
					const srcPath = commands[1] || "."
					const hackmudPath = config.hackmudPath
					const users = options.get("users")?.toString().split(",") || []
					const scripts = options.get("scripts")?.toString().split(",") || []
					const colours = [ redBright, greenBright, yellowBright, blueBright, magentaBright, cyanBright ]
					const configUsers = config.users = config.users || {}

					await push(
						srcPath,
						hackmudPath,
						users,
						scripts,
						({ file, users, error, minLength, srcLength }) => users.length && console.log(
							error
								? `error "${
									error instanceof Error
										? bold(error.message)
										: error
								}" in ${dim(file)}`
								: `pushed ${bold(file)} to ${
									users.map(user =>
										bold((configUsers[user] = configUsers[user] || { colour: colours[Math.floor(Math.random() * colours.length)](user) }).colour)
									).join(", ")
								} | ${bold(String(minLength))} chars from ${bold(String(srcLength))} | saved ${bold(String(srcLength - minLength))} chars | ${bold(`${Math.round(((srcLength / minLength) - 1) * 100)}%`)} compression | ${bold(`${resolvePath(hackmudPath, users[0], "scripts", basename(file, extname(file)))}.js`)}`
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
					const colours = [ redBright, greenBright, yellowBright, blueBright, magentaBright, cyanBright ]
					const configUsers = config.users = config.users || {}
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
										? bold(error.message)
										: error
								}" in ${dim(file)}`
								: `pushed ${bold(file)} to ${
									users.map(user =>
										bold((configUsers[user] = configUsers[user] || { colour: colours[Math.floor(Math.random() * colours.length)](user) }).colour)
									).join(", ")
								} | ${bold(String(minLength))} chars from ${bold(String(srcLength))} | saved ${bold(String(srcLength - minLength))} chars | ${bold(`${Math.round(((srcLength / minLength) - 1) * 100)}%`)} compression | ${bold(`${resolvePath(hackmudPath, users[0], "scripts", basename(file, extname(file)))}.js`)}`
						),
						{ genTypes }
					)
				} else
					console.log("you need to set hackmudPath in config before you can use this command")

				break
			}

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

				break
			}

			case "sync-macros": {
				const { hackmudPath } = await getConfig()

				if (hackmudPath) {
					const { macrosSynced, usersSynced } = await syncMacros(hackmudPath)
					console.log(`synced ${macrosSynced} macros to ${usersSynced} users`)
				} else
					console.log("you need to set hackmudPath in config before you can use this command")

				break
			}

			case "test": {
				const srcPath = resolvePath(commands[1] || ".")
				let errors = 0

				console.log(`testing scripts in ${srcPath}\n`)

				for (const { file, error } of await test(srcPath)) {
					console.log(`error "${error instanceof Error ? bold(error.message) : error}" in ${dim(file)}`)
					errors++
				}

				if (errors) {
					process.exitCode = 1
					console.log(`\nencountered ${errors} errors`)
				} else
					console.log("no errors found")

				break
			}

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
					case "get":
						console.log(exploreObject(await getConfig(), commands.slice(2)))
						break

					case "delete": {
						const config = await getConfig()
						const keys = commands.slice(2)

						if (keys.length) {
							delete exploreObject(config, keys.slice(0, -1))?.[keys.slice(-1)[0]]
							console.log(config)
						} else
							help()

						break
					}

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

					default:
						if (commands[1])
							console.log("unknown command")

					help()
				}

				break
			case "help":
			case "h":
				help()
				break
			case "version":
			case "v":
				version()
				break
			default:
				if (commands[0])
					console.log("unknown command")

				help()
		}

	updateConfig()
})()

function help() {
	switch (commands[0]) {
		case "config":
			switch (commands[1]) {
				case "get":
					console.log("hsm config get <key>")
					break
				case "set":
					console.log("hsm config set <key> <value>")
					break
				case "delete":
					console.log("hsm config delete <key>")
					break
				default:
					console.log("hsm config <get, delete, set>")
			}

			break
		case "push":
			console.log("hsm push [dir]")
			break
		case "watch":
			console.log("hsm watch [dir]")
			break
		case "pull":
			console.log("hsm pull <user.script>")
			break
		// default:
		// 	// console.log("hsm <build, clear, push, sync, watch, sync, config, help / h, version / v>")
		// 	console.log(`${redBright("hsm")} <${yellowBright("command")}> [...${yellowBright("option")}s]\n\n${yellowBright("command")}s:\n  ${greenBright("build")} - ${blueBright("info")}\n  ${greenBright("clear")} - ${blueBright("info")}\n\n${yellowBright("option")}s:\n  help,    h - info\n  version, v - info`)
		default:
			console.log("hsm <push, watch, pull, config>")
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
	for (let key of keys)
		if (createPath)
			object = typeof object[key] == "object" ? object[key] : object[key] = {}
		else
			object = object?.[key]

	return object
}

function updateConfig() {
	if (config) {
		const json = JSON.stringify(config)

		writeFile(configFilePath, json).catch(async error => {
			switch (error.code) {
				case "EISDIR":
					await rmDir(configFilePath)
					break
				case "ENOENT":
					await mkDir(configDirPath)
					break
				default:
					throw error
			}

			writeFile(configFilePath, json)
		})
	}
}
