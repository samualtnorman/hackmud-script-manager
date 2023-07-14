import type { PluginItem } from "@babel/core"
import babelGenerator from "@babel/generator"
import { parse } from "@babel/parser"
import babelPluginProposalClassProperties from "@babel/plugin-proposal-class-properties"
import babelPluginProposalClassStaticBlock from "@babel/plugin-proposal-class-static-block"
import babelPluginProposalDecorators from "@babel/plugin-proposal-decorators"
import babelPluginProposalJSONStrings from "@babel/plugin-proposal-json-strings"
import babelPluginProposalLogicalAssignmentOperators from "@babel/plugin-proposal-logical-assignment-operators"
import babelPluginProposalNullishCoalescingOperator from "@babel/plugin-proposal-nullish-coalescing-operator"
import babelPluginProposalNumericSeparator from "@babel/plugin-proposal-numeric-separator"
import babelPluginProposalObjectRestSpread from "@babel/plugin-proposal-object-rest-spread"
import babelPluginProposalOptionalCatchBinding from "@babel/plugin-proposal-optional-catch-binding"
import babelPluginProposalOptionalChaining from "@babel/plugin-proposal-optional-chaining"
import babelPluginProposalPrivatePropertyInObject from "@babel/plugin-proposal-private-property-in-object"
import babelPluginTransformExponentiationOperator from "@babel/plugin-transform-exponentiation-operator"
import babelTraverse from "@babel/traverse"
import type { LVal } from "@babel/types"
import t from "@babel/types"
import { babel as rollupPluginBabel } from "@rollup/plugin-babel"
import rollupPluginCommonJS from "@rollup/plugin-commonjs"
import rollupPluginJSON from "@rollup/plugin-json"
import rollupPluginNodeResolve from "@rollup/plugin-node-resolve"
import type { LaxPartial } from "@samual/lib"
import { assert } from "@samual/lib/assert"
import { resolve as resolvePath } from "path"
import prettier from "prettier"
import { rollup } from "rollup"
import { supportedExtensions as extensions } from "../constants"
import minify from "./minify"
import postprocess from "./postprocess"
import preprocess from "./preprocess"
import { includesIllegalString, replaceUnsafeStrings } from "./shared"
import transform from "./transform"

const { format } = prettier
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const { default: generate } = babelGenerator as any as typeof import("@babel/generator")
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const { default: traverse } = babelTraverse as any as typeof import("@babel/traverse")

export { minify } from "./minify"
export { postprocess } from "./postprocess"
export { preprocess } from "./preprocess"
export { transform } from "./transform"

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

	/**
	 * when set to `true` forces use of quine cheats
	 *
	 * when set to `false` forces quine cheats not to be used
	 *
	 * when left unset or set to `undefined`, automatically uses or doesn't use quine cheats based on character count
	 */
	forceQuineCheats: boolean
}

/**
 * Minifies a given script
 *
 * @param code JavaScript or TypeScript code
 * @param options {@link ProcessOptions details}
 */
export const processScript = async (
	code: string,
	{
		minify: shouldMinify = true,
		uniqueID = Math.floor(Math.random() * (2 ** 52)).toString(36).padStart(11, `0`),
		scriptUser = `UNKNOWN`,
		scriptName = `UNKNOWN`,
		filePath,
		mangleNames = false,
		forceQuineCheats
	}: LaxPartial<ProcessOptions> = {}
): Promise<{ script: string, warnings: { message: string, line: number }[] }> => {
	assert(/^\w{11}$/.exec(uniqueID))

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

	const plugins: PluginItem[] = [
		[ babelPluginProposalDecorators.default, { decoratorsBeforeExport: true } ],
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
	]

	let filePathResolved

	if (filePath) {
		filePathResolved = resolvePath(filePath)

		if (filePath.endsWith(`.ts`))
			plugins.push([ (await import(`@babel/plugin-transform-typescript`)).default, { allowDeclareFields: true, optimizeConstEnums: true } ])
		else {
			const [
				babelPluginProposalDoExpressions,
				babelPluginProposalFunctionBind,
				babelPluginProposalFunctionSent,
				babelPluginProposalPartialApplication,
				babelPluginProposalPipelineOperator,
				babelPluginProposalThrowExpressions,
				babelPluginProposalRecordAndTuple
			] = await Promise.all([
				import(`@babel/plugin-proposal-do-expressions`),
				import(`@babel/plugin-proposal-function-bind`),
				import(`@babel/plugin-proposal-function-sent`),
				import(`@babel/plugin-proposal-partial-application`),
				import(`@babel/plugin-proposal-pipeline-operator`),
				import(`@babel/plugin-proposal-throw-expressions`),
				import(`@babel/plugin-proposal-record-and-tuple`)
			])

			plugins.push(
				[ babelPluginProposalDoExpressions.default ],
				[ babelPluginProposalFunctionBind.default ],
				[ babelPluginProposalFunctionSent.default ],
				[ babelPluginProposalPartialApplication.default ],
				[ babelPluginProposalPipelineOperator.default, { proposal: `hack`, topicToken: `%` } ],
				[ babelPluginProposalThrowExpressions.default ],
				[ babelPluginProposalRecordAndTuple.default, { syntaxType: `hash`, importPolyfill: true } ]
			)
		}
	} else {
		filePathResolved = `${uniqueID}.ts`

		const [
			babelPluginTransformTypescript,
			babelPluginProposalDoExpressions,
			babelPluginProposalFunctionBind,
			babelPluginProposalFunctionSent,
			babelPluginProposalPartialApplication,
			babelPluginProposalPipelineOperator,
			babelPluginProposalThrowExpressions,
			babelPluginProposalRecordAndTuple
		] = await Promise.all([
			import(`@babel/plugin-transform-typescript`),
			import(`@babel/plugin-proposal-do-expressions`),
			import(`@babel/plugin-proposal-function-bind`),
			import(`@babel/plugin-proposal-function-sent`),
			import(`@babel/plugin-proposal-partial-application`),
			import(`@babel/plugin-proposal-pipeline-operator`),
			import(`@babel/plugin-proposal-throw-expressions`),
			import(`@babel/plugin-proposal-record-and-tuple`)
		])

		plugins.push(
			[ babelPluginTransformTypescript.default, { allowDeclareFields: true, optimizeConstEnums: true } ],
			[ babelPluginProposalDoExpressions.default ],
			[ babelPluginProposalFunctionBind.default ],
			[ babelPluginProposalFunctionSent.default ],
			[ babelPluginProposalPartialApplication.default ],
			[ babelPluginProposalPipelineOperator.default, { proposal: `hack`, topicToken: `%` } ],
			[ babelPluginProposalThrowExpressions.default ],
			[ babelPluginProposalRecordAndTuple.default, { syntaxType: `hash`, importPolyfill: true } ]
		)
	}

	const bundle = await rollup({
		input: filePathResolved,
		plugins: [
			{
				name: `hackmud-script-manager`,
				transform: async code => (await preprocess(code, { uniqueID })).code
			},
			rollupPluginBabel({
				babelHelpers: `bundled`,
				plugins,
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

	if (shouldMinify)
		code = await minify(file, { uniqueID, mangleNames, forceQuineCheats, autocomplete })
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
				} else if (includesIllegalString(memberExpression.property.name)) {
					memberExpression.computed = true

					memberExpression.property = t.stringLiteral(
						replaceUnsafeStrings(uniqueID, memberExpression.property.name)
					)
				}
			},

			VariableDeclarator(path) {
				const renameVariables = (lValue: LVal) => {
					switch (lValue.type) {
						case `Identifier`: {
							if (includesIllegalString(lValue.name))
								path.scope.rename(lValue.name, `$${Math.floor(Math.random() * (2 ** 52)).toString(36).padStart(11, `0`)}`)
						} break

						case `ObjectPattern`: {
							for (const property of lValue.properties) {
								assert(property.type == `ObjectProperty`)
								renameVariables(property.value as LVal)
							}
						} break

						case `ArrayPattern`: {
							for (const element of lValue.elements) {
								if (element)
									renameVariables(element)
							}
						} break

						default:
							throw new Error(`unknown lValue type "${lValue.type}"`)
					}
				}

				renameVariables(path.node.id)
			},

			ObjectProperty({ node: objectProperty }) {
				if (objectProperty.key.type == `Identifier` && includesIllegalString(objectProperty.key.name)) {
					objectProperty.key = t.stringLiteral(replaceUnsafeStrings(uniqueID, objectProperty.key.name))
					objectProperty.shorthand = false
				}
			},

			StringLiteral({ node }) {
				node.value = replaceUnsafeStrings(uniqueID, node.value)
			},

			TemplateLiteral({ node }) {
				for (const templateElement of node.quasis) {
					if (templateElement.value.cooked) {
						templateElement.value.cooked = replaceUnsafeStrings(uniqueID, templateElement.value.cooked)

						templateElement.value.raw = templateElement.value.cooked
							.replaceAll(`\\`, `\\\\`)
							.replaceAll(`\``, `\\\``)
							.replaceAll(`\${`, `$\\{`)
					} else
						templateElement.value.raw = replaceUnsafeStrings(uniqueID, templateElement.value.raw)
				}
			},

			RegExpLiteral(path) {
				path.node.pattern = replaceUnsafeStrings(uniqueID, path.node.pattern)
				delete path.node.extra
			}
		})

		// we can't have comments because they may contain illegal strings
		code = await format(generate(file, { comments: false }).code, {
			parser: `babel`,
			arrowParens: `avoid`,
			semi: false,
			trailingComma: `none`
		})
	}

	code = postprocess(code, seclevel, uniqueID)

	if (includesIllegalString(code))
		throw new Error(`you found a weird edge case where I wasn't able to replace illegal strings like "SC$", please report thx`)

	return {
		script: code,
		warnings: []
	}
}

export default processScript
