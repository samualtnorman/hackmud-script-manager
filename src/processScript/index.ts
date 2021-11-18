import babelGenerator from "@babel/generator"
import { assert, getHackmudCharacterCount } from "@samual/lib"
import { resolve as resolvePath } from "path"
import { performance } from "perf_hooks"
import { compile } from "./compile"
import minify from "./minify"
import postprocess from "./postprocess"
import preprocess from "./preprocess"

const { default: generate } = babelGenerator as any as typeof import("@babel/generator")

export { compile } from "./compile"
export { minify } from "./minify"
export { postprocess } from "./postprocess"
export { preprocess } from "./preprocess"

export type ProcessOptions = {
	/** whether to minify the given code */
	minify: boolean

	/** 11 a-z 0-9 characters */
	uniqueID: string

	/** the user the script will be uploaded to (or set to `true` if it is not yet known) */
	scriptUser: string | true

	/** the name of this script (or set to `true` if it is not yet known) */
	scriptName: string | true

	filePath: string
}

/**
 * Minifies a given script
 *
 * @param code JavaScript or TypeScript code
 * @param options {@link ProcessOptions details}
 */
export async function processScript(
	code: string,
	{
		minify: shouldMinify = true,
		uniqueID = Math.floor(Math.random() * (2 ** 52)).toString(36).padStart(11, "0"),
		scriptUser = "UNKNOWN",
		scriptName = "UNKNOWN",
		filePath
	}: Partial<ProcessOptions> = {}
): Promise<{
	srcLength: number
	script: string
	warnings: { message: string, line: number }[]
	timeTook: number
}> {
	assert(uniqueID.match(/^\w{11}$/))

	if (filePath)
		filePath = resolvePath(filePath)
	else
		filePath = "script"

	const time = performance.now()
	const sourceCode = code
	let autocomplete
	let seclevel
	let semicolons

	({ autocomplete, code, seclevel, semicolons } = preprocess(code, { uniqueID }))

	code = generate(await compile(code, { uniqueID, sourceCode, scriptUser, scriptName, seclevel, filePath })!).code

	// TODO fix incorrect source length again

	// the typescript inserts semicolons where they weren't already so we take
	// all semicolons out of the count and add the number of semicolons in the
	// source to make things fair
	let srcLength = getHackmudCharacterCount(code.replace(/^function\s*\w+\(/, "function("))
		- (code.match(/;/g)?.length || 0)
		+ semicolons
		// + (code.match(/SC\$[a-zA-Z_][a-zA-Z0-9_]*\$[a-zA-Z_][a-zA-Z0-9_]*\(/g)?.length ?? 0)
		// + (code.match(/DB\$/g)?.length ?? 0)

	if (shouldMinify)
		code = await minify(code, autocomplete, uniqueID)

	code = postprocess(code, seclevel, uniqueID)

	return {
		srcLength,
		script: code,
		warnings: [],
		timeTook: performance.now() - time
	}
}

export default processScript
