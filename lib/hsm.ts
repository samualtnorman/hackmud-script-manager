import { readFile, mkdir as mkDir, writeFile, rmdir as rmDir } from "fs/promises"
import { resolve as resolvePath } from "path"
import { homedir as homeDir } from "os"
import { build, clear, pull, push, pushBuilt, watch } from "hackmud_env-tools"
import { redBright, yellowBright, greenBright, blueBright, cyanBright, magentaBright, bold, dim } from "ansi-colors"

interface LooseObject<T = any> {
	[key: string]: T | undefined
}

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

const configDir = resolvePath(homeDir(), ".config")
const configFile = resolvePath(configDir, "hsm.json")

const options = new Map<string, ArgValue>()
const commands: string[] = []

// const helpConfig = {
// 	config: {
// 		set: [ "key", "value" ]
// 	}
// }

let config: LooseObject &  Partial<{
	hackmudPath: string
	defaultUser: string
	users: LooseObject<{
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
			case "build":
				for (const { name, oldLength, minLength } of await build(commands[1] || "src", commands[2] || "dist"))
					console.log(`built ${name} [saved ${oldLength - minLength} chars]`)

				break

			case "clear": {
				const config = await getConfig()

				if (config.hackmudPath) {
					const target = commands[1] || "dist"
					const user = commands[2] || config.defaultUser

					if (user) {
						const { pushedRemoved, targetRemoved } = await clear(target, config.hackmudPath, user)

						console.log(`cleared ${targetRemoved} file(s) from ${target} and ${pushedRemoved} file(s) from ${user}`)
					} else
						console.log("set defaultUser in config first")
				} else
					console.log("set hackmudPath in config first")

				break
			}

			case "push-built": {
				const config = await getConfig()

				if (config.hackmudPath) {
					const target = commands[1] || "dist"
					const user = commands[2] || config.defaultUser

					if (user) {
						const { pushedCount } = await pushBuilt(target, config.hackmudPath, user)

						console.log(`pushed ${pushedCount} file(s) to ${user}`)
					} else
						console.log("set defaultUser in config first")
				} else
					console.log("set hackmudPath in config first")

				break
			}

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
						({ minLength, srcLength, users, script }) =>
							users.length && console.log(
								`wrote ${
									bold(minLength.toString())
								} chars from ${
									dim(script)
								} to ${
									users.map(user =>
										(configUsers[user] = configUsers[user] || { colour: colours[Math.floor(Math.random() * colours.length)](user) }).colour
									).join(", ")
								} and saved ${
										bold((srcLength - minLength).toString())
								} chars`
							)
					)
				} else
					console.log("you need to set hackmudPath in config before you can use this command")

				break
			}

			case "watch": {
				const config = await getConfig()

				if (config.hackmudPath) {
					const srcPath = commands[1] || "."
					const hackmudPath = config.hackmudPath
					const users = options.get("users")?.toString().split(",") || []
					const scripts = options.get("scripts")?.toString().split(",") || []
					const colours = [ redBright, greenBright, yellowBright, blueBright, magentaBright, cyanBright ]
					const configUsers = config.users = config.users || {}

					watch(
						srcPath,
						hackmudPath,
						users,
						scripts,
						({ minLength, srcLength, users, script }) => {
							users.length && console.log(
								`wrote ${
									bold(minLength.toString())
								} chars from ${
									dim(script)
								} to ${
									users.map(user =>
										(configUsers[user] = configUsers[user] || { colour: colours[Math.floor(Math.random() * colours.length)](user) }).colour
									).join(", ")
								} and saved ${
										bold((srcLength - minLength).toString())
								} chars`
							)

							updateConfig()
						}
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
						pull(srcPath, hackmudPath, script)
					} else
						help()
				} else
					console.log("you need to set hackmudPath in config before you can use this command")

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
				case "set":
					console.log("hsm config set <key> <value>")
					break
				default:
					console.log("hsm config <get, delete, set>")
			}
			break
		default:
			// console.log("hsm <build, clear, push, sync, watch, sync, config, help / h, version / v>")
			console.log(`${redBright("hsm")} <${yellowBright("command")}> [...${yellowBright("option")}s]\n\n${yellowBright("command")}s:\n  ${greenBright("build")} - ${blueBright("info")}\n  ${greenBright("clear")} - ${blueBright("info")}\n\n${yellowBright("option")}s:\n  help,    h - info\n  version, v - info`)
	}
}

async function version() {
	console.log(JSON.parse(await readFile(resolvePath(__dirname, "package.json"), { encoding: "utf-8" })).version || "unknown")
}

async function getConfig() {
	if (config)
		return config

	try {
		config = JSON.parse(await readFile(configFile, { encoding: "utf-8" }))
	} finally {
		if (typeof config != "object")
			config = {}
	}

	return config
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

		writeFile(configFile, json).catch(async error => {
			switch (error.code) {
				case "EISDIR":
					await rmDir(configFile)
					break
				case "ENOENT":
					await mkDir(configDir)
					break
				default:
					throw error
			}

			writeFile(configFile, json)
		})
	}
}
