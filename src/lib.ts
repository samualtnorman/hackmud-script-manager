import { writeFile, mkdir as mkDir, copyFile } from "fs/promises"
import { resolve as resolvePath } from "path"
import { BaseEncodingOptions, Mode, OpenMode, PathLike } from "fs"
import { Stream } from "stream"
import { Abortable } from "events"

export async function writeFilePersist(
	path: string,
	data: string | NodeJS.ArrayBufferView | Iterable<string | NodeJS.ArrayBufferView> | AsyncIterable<string | NodeJS.ArrayBufferView> | Stream,
	options?: BaseEncodingOptions & { mode?: Mode, flag?: OpenMode } & Abortable | BufferEncoding | null
) {
	await writeFile(path, data, options).catch(async (error: NodeJS.ErrnoException) => {
		switch (error.code) {
			case "ENOENT":
				await mkDir(resolvePath(path, ".."), { recursive: true })
				await writeFile(path, data, options)
				break
			default:
				throw error
		}
	})
}

export async function copyFilePersist(path: PathLike, dest: string, flags?: number) {
	await copyFile(path, dest, flags).catch(async (error: NodeJS.ErrnoException) => {
		switch (error.code) {
			case "ENOENT":
				await mkDir(resolvePath(dest, ".."), { recursive: true })
				await copyFile(path, dest, flags)
				break
			default:
				throw error
		}
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
