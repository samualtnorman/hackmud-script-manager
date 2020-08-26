#!/usr/bin/env node

import { readFile, mkdir as mkDir, writeFile, rmdir as rmDir } from "fs/promises"
import { resolve as resolvePath } from "path"
import { homedir as homeDir } from "os"
import { build, clear, push, sync, watch } from "hackmud_env-tools"
import { red, yellow, green, blue } from "ansi-colors"

type ArgValue = boolean | number | string | ArgValue[]

const configDir = resolvePath(homeDir(), ".config")
const configFile = resolvePath(configDir, "hsm.json")

const options = new Map<string, ArgValue>()
const commands: string[] = []

// const helpConfig = {
// 	config: {
// 		set: [ "key", "value" ]
// 	}
// }

let config: Partial<{
	hackmudPath: string
	defaultUser: string
	[key: string]: any
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
				break
			case "clear":
				break
			case "push":
				break
			case "sync":
				break
			case "watch":
				break
			case "sync":
				// console.log(await sync())
				break

			case "config":
				switch (commands[1]) {
					case "get":
						console.log(exploreObject(await getConfig(), ...commands.slice(2)))
						break
					case "delete":
						break
					case "set":
						const keys = commands.slice(2)

						if (keys.length) {
							let value
	
							if (keys.length == 1) {
								value = undefined
							} else {
								value = keys.pop()
							}

							console.log({ keys, value })
						} else
							help()

						// // exploreObject(await getConfig(), ...keys.slice(0, -1))[keys.slice(-1)[0]] = value

						// let object = await getConfig()

						// for (let key of keys.slice(0, -1))
						// 	object = object[key] || {}

						// object[keys.slice(-1)[0]] = value
						
						// console.log(await getConfig())
						break
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
			console.log(`${red("hsm")} <${yellow("command")}> [...${yellow("option")}s]\n\n${yellow("command")}s:\n  ${green("build")} - ${blue("info")}\n  ${green("clear")} - ${blue("info")}\n\n${yellow("option")}s:\n  help,    h - info\n  version, v - info`)
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

function exploreObject(object: any, ...keys: string[]) {
	for (let key of keys)
		object = object?.[key]

	return object
}
