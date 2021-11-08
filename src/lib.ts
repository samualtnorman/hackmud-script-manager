import fs, { PathLike } from "fs"
import { dirname as pathDirectory } from "path"

const { writeFile, mkdir: makeDirectory, copyFile } = fs.promises

export function writeFilePersist(
	path: string,
	data: any,
	options?: { encoding?: string | null | undefined, mode?: string | number | undefined, flag?: string | number | undefined } | string | null
) {
	return writeFile(path, data, options).catch(async (error: NodeJS.ErrnoException) => {
		if (error.code != "ENOENT")
			throw error

		await makeDirectory(pathDirectory(path), { recursive: true })
		await writeFile(path, data, options)
	})
}

export function copyFilePersist(src: PathLike, dest: string, flags?: number) {
	return copyFile(src, dest, flags).catch(async (error: NodeJS.ErrnoException) => {
		if (error.code != "ENOENT")
			throw error

		await makeDirectory(pathDirectory(dest), { recursive: true })
		await copyFile(src, dest, flags)
	})
}

export function hackmudLength(script: string) {
	return script.replace(/\/\/.*/g, "").replace(/[ \t\n\r\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000]/g, "").length
}

export function positionToLineNumber(position: number, script: string) {
	let totalCharacters = 0

	for (const [ lineNumber, line ] of script.split("\n").entries()) {
		totalCharacters += line.length + 1

		if (position < totalCharacters)
			return lineNumber
	}

	throw new Error("unreachable")
}

export function stringSplice(original: string, replacement: string, start: number, end = start) {
	return original.slice(0, start) + replacement + original.slice(end)
}

export class DynamicMap<K, V> extends Map<K, V> {
	constructor(private fallbackHandler: (key: K) => V) { super() }

	override get(key: K) {
		if (super.has(key))
			return super.get(key)!

		const value = this.fallbackHandler(key)

		super.set(key, value)

		return value
	}
}

export class CustomError extends Error {
	override name = this.constructor.name
}

export class AssertError extends CustomError {}

export function assert(value: any, message = "assertion failed"): asserts value {
	if (!value)
		throw new AssertError(message)
}
