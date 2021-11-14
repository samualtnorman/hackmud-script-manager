import babelGenerator from "@babel/generator"
import { performance } from "perf_hooks"
import { hackmudLength } from "../lib"
import { compile } from "./compile"
import minify from "./minify"
import postProcess from "./postProcess"
import preProcess from "./preProcess"

const { default: generate } = babelGenerator as any as typeof import("@babel/generator")

export { compile } from "./compile"
export { minify } from "./minify"
export { postProcess } from "./postProcess"
export { preProcess } from "./preProcess"

/**
 * Minifies a given script
 *
 * @param code JavaScript or TypeScript code
 */
export async function processScript(
	code: string,
	{
		minify: shouldMinify = true,
		randomString = Math.floor(Math.random() * (2 ** 52)).toString(36),
		scriptUser = "UNKNOWN" as string | true,
		scriptName = "UNKNOWN" as string | true
	} = {}
): Promise<{
	srcLength: number
	script: string
	warnings: { message: string, line: number }[]
	timeTook: number
}> {
	const time = performance.now()
	const sourceCode = code
	let autocomplete
	let seclevel
	let semicolons

	({ autocomplete, code, seclevel, semicolons } = preProcess(code))

	code = generate(await compile(code, randomString, sourceCode, scriptUser, scriptName)!).code

	// the typescript inserts semicolons where they weren't already so we take
	// all semicolons out of the count and add the number of semicolons in the
	// source to make things fair
	let srcLength = hackmudLength(code.replace(/^function\s*\w+\(/, "function("))
		- (code.match(/;/g)?.length ?? 0)
		+ semicolons
		+ (code.match(/SC\$[a-zA-Z_][a-zA-Z0-9_]*\$[a-zA-Z_][a-zA-Z0-9_]*\(/g)?.length ?? 0)
		+ (code.match(/DB\$/g)?.length ?? 0)

	if (shouldMinify)
		code = await minify(code, autocomplete, randomString)

	code = postProcess(code, seclevel)

	return {
		srcLength,
		script: code,
		warnings: [],
		timeTook: performance.now() - time
	}
}

export default processScript
