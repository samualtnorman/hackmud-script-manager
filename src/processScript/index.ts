import babelGenerator from "@babel/generator"
import { parse } from "@babel/parser"
import babelPluginProposalClassProperties from "@babel/plugin-proposal-class-properties"
import babelPluginProposalClassStaticBlock from "@babel/plugin-proposal-class-static-block"
import babelPluginProposalDecorators from "@babel/plugin-proposal-decorators"
import babelPluginProposalDoExpressions from "@babel/plugin-proposal-do-expressions"
import babelPluginProposalFunctionBind from "@babel/plugin-proposal-function-bind"
import babelPluginProposalFunctionSent from "@babel/plugin-proposal-function-sent"
import babelPluginProposalJSONStrings from "@babel/plugin-proposal-json-strings"
import babelPluginProposalLogicalAssignmentOperators from "@babel/plugin-proposal-logical-assignment-operators"
import babelPluginProposalNullishCoalescingOperator from "@babel/plugin-proposal-nullish-coalescing-operator"
import babelPluginProposalNumericSeparator from "@babel/plugin-proposal-numeric-separator"
import babelPluginProposalObjectRestSpread from "@babel/plugin-proposal-object-rest-spread"
import babelPluginProposalOptionalCatchBinding from "@babel/plugin-proposal-optional-catch-binding"
import babelPluginProposalOptionalChaining from "@babel/plugin-proposal-optional-chaining"
import babelPluginProposalPartialApplication from "@babel/plugin-proposal-partial-application"
import babelPluginProposalPipelineOperator from "@babel/plugin-proposal-pipeline-operator"
import babelPluginProposalPrivatePropertyInObject from "@babel/plugin-proposal-private-property-in-object"
import babelPluginProposalRecordAndTuple from "@babel/plugin-proposal-record-and-tuple"
import babelPluginProposalThrowExpressions from "@babel/plugin-proposal-throw-expressions"
import babelPluginTransformExponentiationOperator from "@babel/plugin-transform-exponentiation-operator"
import babelPluginTransformTypescript from "@babel/plugin-transform-typescript"
import babelTraverse from "@babel/traverse"
import t from "@babel/types"
import rollupPluginBabel_ from "@rollup/plugin-babel"
import rollupPluginCommonJS from "@rollup/plugin-commonjs"
import rollupPluginJSON from "@rollup/plugin-json"
import rollupPluginNodeResolve from "@rollup/plugin-node-resolve"
import { assert, countHackmudCharacters } from "@samual/lib"
import { resolve as resolvePath } from "path"
import { performance } from "perf_hooks"
import prettier from "prettier"
import { rollup } from "rollup"
import { supportedExtensions as extensions } from "../constants.json"
import minify from "./minify"
import postprocess from "./postprocess"
import preprocess from "./preprocess"
import transform from "./transform"

const { default: rollupPluginBabel } = rollupPluginBabel_ as any as typeof import("@rollup/plugin-babel")
const { format } = prettier
const { default: generate } = babelGenerator as any as typeof import("@babel/generator")
const { default: traverse } = babelTraverse as any as typeof import("@babel/traverse")

export { minify } from "./minify"
export { postprocess } from "./postprocess"
export { preprocess } from "./preprocess"
export { transform as compile } from "./transform"

export type ProcessOptions = {
	/** whether to minify the given code */
	minify: boolean

	/** 11 a-z 0-9 characters */
	uniqueID: string

	/** the user going to be hosting this script (or set to `true` if not yet known) */
	scriptUser: string | true

	/** the name of this script (or set to `true` if not yet known) */
	scriptName: string | true

	filePath: string

	/** whether to mangle function and class names (defaults to `false`) */
	mangleNames: boolean
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
		uniqueID = Math.floor(Math.random() * (2 ** 52)).toString(36).padStart(11, `0`),
		scriptUser = `UNKNOWN`,
		scriptName = `UNKNOWN`,
		filePath,
		mangleNames = false
	}: Partial<ProcessOptions> = {}
): Promise<{
	srcLength: number
	script: string
	warnings: { message: string, line: number }[]
	timeTook: number
}> {
	assert(/^\w{11}$/.exec(uniqueID))

	const time = performance.now()
	const sourceCode = code
	let autocomplete
	let statedSeclevel

	// TODO do seclevel detection and verification per module

	const autocompleteMatch = /^function\s*\(.+\/\/(?<autocomplete>.+)/.exec(code)

	if (autocompleteMatch) {
		code = `export default ${code}`;
		({ autocomplete } = autocompleteMatch.groups!)
	} else {
		for (const line of code.split(`\n`)) {
			const comment = /^\s*\/\/(?<commentContent>.+)/.exec(line)

			if (!comment)
				break

			const commentContent = comment.groups!.commentContent!.trim()

			if (commentContent.startsWith(`@autocomplete `))
				autocomplete = commentContent.slice(14).trimStart()
			else if (commentContent.startsWith(`@seclevel `)) {
				const seclevelString = commentContent.slice(10).trimStart().toLowerCase()

				switch (seclevelString) {
					case `fullsec`:
					case `full`:
					case `fs`:
					case `4s`:
					case `f`:
					case `4`: {
						statedSeclevel = 4
					} break

					case `highsec`:
					case `high`:
					case `hs`:
					case `3s`:
					case `h`:
					case `3`: {
						statedSeclevel = 3
					} break

					case `midsec`:
					case `mid`:
					case `ms`:
					case `2s`:
					case `m`:
					case `2`: {
						statedSeclevel = 2
					} break

					case `lowsec`:
					case `low`:
					case `ls`:
					case `1s`:
					case `l`:
					case `1`: {
						statedSeclevel = 1
					} break

					case `nullsec`:
					case `null`:
					case `ns`:
					case `0s`:
					case `n`:
					case `0`: {
						statedSeclevel = 0
					} break

					default:
						// TODO turn into warninig when I get round to those
						throw new Error(`unrecognised seclevel "${seclevelString}"`)
				}
			}
		}
	}

	assert(/^\w{11}$/.exec(uniqueID))

	const filePathResolved = filePath
		? resolvePath(filePath)
		: `${uniqueID}.ts`

	const bundle = await rollup({
		input: filePathResolved,
		plugins: [
			{
				name: `hackmud-script-manager`,
				transform: code => preprocess(code, { uniqueID }).code
			},
			rollupPluginBabel({
				babelHelpers: `bundled`,
				plugins: [
					[ babelPluginTransformTypescript.default, { allowDeclareFields: true, optimizeConstEnums: true } ],
					[ babelPluginProposalDecorators.default, { decoratorsBeforeExport: true } ],
					[ babelPluginProposalDoExpressions.default ],
					[ babelPluginProposalFunctionBind.default ],
					[ babelPluginProposalFunctionSent.default ],
					[ babelPluginProposalPartialApplication.default ],
					[ babelPluginProposalPipelineOperator.default, { proposal: `hack`, topicToken: `%` } ],
					[ babelPluginProposalThrowExpressions.default ],
					[ babelPluginProposalRecordAndTuple.default, { syntaxType: `hash`, importPolyfill: true } ],
					[ babelPluginProposalClassProperties.default ],
					[ babelPluginProposalClassStaticBlock.default ],
					[ babelPluginProposalPrivatePropertyInObject.default ],
					[ babelPluginProposalLogicalAssignmentOperators.default ],
					[ babelPluginProposalNumericSeparator.default ],
					[ babelPluginProposalNullishCoalescingOperator.default ],
					[ babelPluginProposalOptionalChaining.default ],
					[ babelPluginProposalOptionalCatchBinding.default ],
					[ babelPluginProposalJSONStrings.default ],
					[ babelPluginProposalObjectRestSpread.default ],
					[ babelPluginTransformExponentiationOperator.default ]
				],
				configFile: false,
				extensions
			}),
			rollupPluginCommonJS(),
			rollupPluginNodeResolve({ extensions }),
			rollupPluginJSON()
		],
		treeshake: { moduleSideEffects: false }
	})

	const seclevelNames = [ `NULLSEC`, `LOWSEC`, `MIDSEC`, `HIGHSEC`, `FULLSEC` ]

	code = (await bundle.generate({})).output[0].code

	const { file, seclevel } = transform(parse(code, { sourceType: `module` }), sourceCode, { uniqueID, scriptUser, scriptName })

	if (statedSeclevel != undefined && seclevel < statedSeclevel)
		// TODO replace with a warning and build script anyway
		throw new Error(`detected seclevel ${seclevelNames[seclevel]} is lower than stated seclevel ${seclevelNames[statedSeclevel]}`)

	code = generate(file).code

	// TODO fix incorrect source length again

	// the typescript inserts semicolons where they weren't already so we take
	// all semicolons out of the count and add the number of semicolons in the
	// source to make character count fairer
	const sourceLength = countHackmudCharacters(code.replace(/^function\s*\w+\(/, `function(`))
		// - (code.match(/;/g)?.length || 0)
		// + semicolons
		// + (code.match(/SC\$[a-zA-Z_][a-zA-Z0-9_]*\$[a-zA-Z_][a-zA-Z0-9_]*\(/g)?.length ?? 0)
		// + (code.match(/DB\$/g)?.length ?? 0)

	if (shouldMinify)
		code = await minify(file, autocomplete, { uniqueID, mangleNames })
	else {
		traverse(file, {
			MemberExpression({ node: memberExpression }) {
				if (memberExpression.computed)
					return

				assert(memberExpression.property.type == `Identifier`)

				if (memberExpression.property.name == `prototype`) {
					memberExpression.computed = true
					memberExpression.property = t.stringLiteral(`prototype`)
				} else if (memberExpression.property.name == `__proto__`) {
					memberExpression.computed = true
					memberExpression.property = t.stringLiteral(`__proto__`)
				}
			}
		})

		code = format(generate(file).code, {
			parser: `babel`,
			arrowParens: `avoid`,
			semi: false,
			trailingComma: `none`
		})
	}

	code = postprocess(code, seclevel, uniqueID)

	return {
		srcLength: sourceLength,
		script: code,
		warnings: [],
		timeTook: performance.now() - time
	}
}

export default processScript
