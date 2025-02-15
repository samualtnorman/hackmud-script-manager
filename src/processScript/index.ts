/* eslint-disable jsdoc/check-param-names */
import type { NodePath, PluginItem } from "@babel/core"
import type { LVal, Program } from "@babel/types"
import type { LaxPartial } from "@samual/lib"
import { readFile, readdir as readFolder } from "fs/promises"
import { basename as getPathBasename, relative as getRelativePath, isAbsolute as isAbsolutePath, sep as pathSeparator, resolve as resolvePath } from "path"
import generate from "@babel/generator"
import { parse } from "@babel/parser"
import babelPluginProposalDecorators from "@babel/plugin-proposal-decorators"
import babelPluginProposalDestructuringPrivate from "@babel/plugin-proposal-destructuring-private"
import babelPluginProposalExplicitResourceManagement from "@babel/plugin-proposal-explicit-resource-management"
import babelPluginTransformClassProperties from "@babel/plugin-transform-class-properties"
import babelPluginTransformClassStaticBlock from "@babel/plugin-transform-class-static-block"
import babelPluginTransformExponentiationOperator from "@babel/plugin-transform-exponentiation-operator"
import babelPluginTransformJsonStrings from "@babel/plugin-transform-json-strings"
import babelPluginTransformLogicalAssignmentOperators from "@babel/plugin-transform-logical-assignment-operators"
import babelPluginTransformNullishCoalescingOperator from "@babel/plugin-transform-nullish-coalescing-operator"
import babelPluginTransformNumericSeparator from "@babel/plugin-transform-numeric-separator"
import babelPluginTransformObjectRestSpread from "@babel/plugin-transform-object-rest-spread"
import babelPluginTransformOptionalCatchBinding from "@babel/plugin-transform-optional-catch-binding"
import babelPluginTransformOptionalChaining from "@babel/plugin-transform-optional-chaining"
import babelPluginTransformPrivatePropertyInObject from "@babel/plugin-transform-private-property-in-object"
import babelPluginTransformUnicodeSetsRegex from "@babel/plugin-transform-unicode-sets-regex"
import traverse from "@babel/traverse"
import t from "@babel/types"
import rollupPluginAlias from "@rollup/plugin-alias"
import { babel as rollupPluginBabel } from "@rollup/plugin-babel"
import rollupPluginCommonJS from "@rollup/plugin-commonjs"
import rollupPluginJSON from "@rollup/plugin-json"
import rollupPluginNodeResolve from "@rollup/plugin-node-resolve"
import { assert } from "@samual/lib/assert"
import prettier from "prettier"
import { rollup } from "rollup"
import { supportedExtensions as extensions } from "../constants"
import { minify } from "./minify"
import { postprocess } from "./postprocess"
import { preprocess } from "./preprocess"
import { getReferencePathsToGlobal, includesIllegalString, replaceUnsafeStrings } from "./shared"
import { transform } from "./transform"

const { format } = prettier

export { minify } from "./minify"
export { postprocess } from "./postprocess"
export { preprocess } from "./preprocess"
export { transform } from "./transform"

export type ProcessOptions = LaxPartial<{
	/** whether to minify the given code */ minify: boolean
	/** 11 a-z 0-9 characters */ uniqueId: string
	/** the user going to be hosting this script (or set to `true` if not yet known) */ scriptUser: string | true
	filePath: string
	/** whether to mangle function and class names (defaults to `false`) */ mangleNames: boolean

	/**
	 * when set to `true` forces use of quine cheats
	 *
	 * when set to `false` forces quine cheats not to be used
	 *
	 * when left unset or set to `undefined`, automatically uses or doesn't use quine cheats based on character count
	 */
	forceQuineCheats: boolean

	rootFolderPath: string
}> & { /** the name of this script (or set to `true` if not yet known) */ scriptName: string | true }

/**
 * Minifies a given script
 * @param code JavaScript or TypeScript code
 * @param options {@link ProcessOptions details}
 */
export async function processScript(code: string, {
	minify: shouldMinify = true,
	uniqueId = Math.floor(Math.random() * (2 ** 52)).toString(36).padStart(11, `0`),
	scriptUser,
	scriptName,
	filePath,
	mangleNames = false,
	forceQuineCheats,
	rootFolderPath
}: ProcessOptions): Promise<{ script: string, warnings: { message: string }[] }> {
	assert(/^\w{11}$/.exec(uniqueId), HERE)

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
					case `4`:
						statedSeclevel = 4
						break

					case `highsec`:
					case `high`:
					case `hs`:
					case `3s`:
					case `h`:
					case `3`:
						statedSeclevel = 3
						break

					case `midsec`:
					case `mid`:
					case `ms`:
					case `2s`:
					case `m`:
					case `2`:
						statedSeclevel = 2
						break

					case `lowsec`:
					case `low`:
					case `ls`:
					case `1s`:
					case `l`:
					case `1`:
						statedSeclevel = 1
						break

					case `nullsec`:
					case `null`:
					case `ns`:
					case `0s`:
					case `n`:
					case `0`:
						statedSeclevel = 0
						break

					default:
						// TODO turn into warning when I get round to those
						throw Error(`unrecognised seclevel "${seclevelString}"`)
				}
			}
		}
	}

	assert(/^\w{11}$/.exec(uniqueId), HERE)

	const plugins: PluginItem[] = [
		[ babelPluginProposalDecorators, { decoratorsBeforeExport: true } ],
		[ babelPluginTransformClassProperties ],
		[ babelPluginTransformClassStaticBlock ],
		[ babelPluginTransformPrivatePropertyInObject ],
		[ babelPluginTransformLogicalAssignmentOperators ],
		[ babelPluginTransformNumericSeparator ],
		[ babelPluginTransformNullishCoalescingOperator ],
		[ babelPluginTransformOptionalChaining ],
		[ babelPluginTransformOptionalCatchBinding ],
		[ babelPluginTransformJsonStrings ],
		[ babelPluginTransformObjectRestSpread ],
		[ babelPluginTransformExponentiationOperator ],
		[ babelPluginTransformUnicodeSetsRegex ],
		[ babelPluginProposalDestructuringPrivate ],
		[ babelPluginProposalExplicitResourceManagement ]
	]

	let filePathResolved

	if (filePath) {
		filePathResolved = getRelativePath(`.`, filePath)

		if (filePath.endsWith(`.ts`)) {
			plugins.push([
				(await import(`@babel/plugin-transform-typescript`)),
				{ allowDeclareFields: true, optimizeConstEnums: true }
			])
		} else {
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
				[ babelPluginProposalDoExpressions ],
				[ babelPluginProposalFunctionBind ],
				[ babelPluginProposalFunctionSent ],
				[ babelPluginProposalPartialApplication ],
				[ babelPluginProposalPipelineOperator, { proposal: `hack`, topicToken: `%` } ],
				[ babelPluginProposalThrowExpressions ],
				[ babelPluginProposalRecordAndTuple, { syntaxType: `hash`, importPolyfill: true } ]
			)
		}
	} else {
		filePathResolved = `${uniqueId}.ts`

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
			[ babelPluginTransformTypescript, { allowDeclareFields: true, optimizeConstEnums: true } ],
			[ babelPluginProposalDoExpressions ],
			[ babelPluginProposalFunctionBind ],
			[ babelPluginProposalFunctionSent ],
			[ babelPluginProposalPartialApplication ],
			[ babelPluginProposalPipelineOperator, { proposal: `hack`, topicToken: `%` } ],
			[ babelPluginProposalThrowExpressions ],
			[ babelPluginProposalRecordAndTuple, { syntaxType: `hash`, importPolyfill: true } ]
		)
	}

	const bundle = await rollup({
		input: filePathResolved,
		plugins: [
			rollupPluginJSON({ preferConst: true }),
			{
				name: `hackmud-script-manager`,
				async transform(code, id) {
					if (isAbsolutePath(id) && !id.includes(`${pathSeparator}node_modules${pathSeparator}`))
						return (await preprocess(code, { uniqueId })).code

					let program!: NodePath<Program>

					traverse(parse(code, { sourceType: `module` }), {
						Program(path) {
							program = path
							path.skip()
						}
					})

					for (const referencePath of getReferencePathsToGlobal(`JSON`, program)) {
						if (referencePath.parentPath.node.type == `MemberExpression` &&
							referencePath.parentPath.node.property.type == `Identifier`
						) {
							if (referencePath.parentPath.node.property.name == `parse`)
								referencePath.parentPath.node.property.name = `oparse`
							else if (referencePath.parentPath.node.property.name == `stringify`)
								referencePath.parentPath.node.property.name = `ostringify`
						}
					}

					return generate(program.node).code
				}
			},
			rollupPluginBabel({
				babelHelpers: `bundled`,
				plugins,
				configFile: false,
				extensions
			}),
			rollupPluginCommonJS(),
			rollupPluginNodeResolve({ extensions }),
			!!rootFolderPath && rollupPluginAlias({ entries: [ { find: /^\//, replacement: `${rootFolderPath}/` } ] })
		],
		treeshake: { moduleSideEffects: false }
	})

	const seclevelNames = [ `NULLSEC`, `LOWSEC`, `MIDSEC`, `HIGHSEC`, `FULLSEC` ]

	code = (await bundle.generate({})).output[0].code

	const { file, seclevel, warnings } =
		transform(parse(code, { sourceType: `module` }), sourceCode, { uniqueId, scriptUser, scriptName })

	if (statedSeclevel != undefined && seclevel < statedSeclevel) {
		// TODO replace with a warning and build script anyway
		throw Error(`detected seclevel ${seclevelNames[seclevel]} is lower than stated seclevel ${
			seclevelNames[statedSeclevel]
		}`)
	}

	code = generate(file).code

	if (shouldMinify)
		code = await minify(file, { uniqueId, mangleNames, forceQuineCheats, autocomplete })
	else {
		traverse(file, {
			MemberExpression({ node: memberExpression }) {
				if (memberExpression.computed)
					return

				assert(memberExpression.property.type == `Identifier`, HERE)

				if (memberExpression.property.name == `prototype`) {
					memberExpression.computed = true
					memberExpression.property = t.stringLiteral(`prototype`)
				} else if (memberExpression.property.name == `__proto__`) {
					memberExpression.computed = true
					memberExpression.property = t.stringLiteral(`__proto__`)
				} else if (includesIllegalString(memberExpression.property.name)) {
					memberExpression.computed = true

					memberExpression.property = t.stringLiteral(
						replaceUnsafeStrings(uniqueId, memberExpression.property.name)
					)
				}
			},
			VariableDeclarator(path) {
				const renameVariables = (lValue: LVal) => {
					switch (lValue.type) {
						case `Identifier`:
							if (includesIllegalString(lValue.name)) {
								path.scope.rename(
									lValue.name,
									`$${Math.floor(Math.random() * (2 ** 52)).toString(36).padStart(11, `0`)}`
								)
							}

							break

						case `ObjectPattern`:
							for (const property of lValue.properties) {
								assert(property.type == `ObjectProperty`, HERE)
								renameVariables(property.value as LVal)
							}

							break

						case `ArrayPattern`:
							for (const element of lValue.elements) {
								if (element)
									renameVariables(element)
							}

							break

						default:
							throw Error(`unknown lValue type "${lValue.type}"`)
					}
				}

				renameVariables(path.node.id)
			},
			ObjectProperty({ node: objectProperty }) {
				if (objectProperty.key.type == `Identifier` && includesIllegalString(objectProperty.key.name)) {
					objectProperty.key = t.stringLiteral(replaceUnsafeStrings(uniqueId, objectProperty.key.name))
					objectProperty.shorthand = false
				}
			},
			StringLiteral({ node }) {
				node.value = replaceUnsafeStrings(uniqueId, node.value)
			},
			TemplateLiteral({ node }) {
				for (const templateElement of node.quasis) {
					if (templateElement.value.cooked) {
						templateElement.value.cooked = replaceUnsafeStrings(uniqueId, templateElement.value.cooked)

						templateElement.value.raw = templateElement.value.cooked
							.replaceAll(`\\`, `\\\\`)
							.replaceAll(`\``, `\\\``)
							.replaceAll(`\${`, `$\\{`)
					} else
						templateElement.value.raw = replaceUnsafeStrings(uniqueId, templateElement.value.raw)
				}
			},
			RegExpLiteral(path) {
				path.node.pattern = replaceUnsafeStrings(uniqueId, path.node.pattern)
				delete path.node.extra
			}
		})

		// we can't have comments because they may contain illegal strings
		code = await format(
			generate(file, { comments: false }).code,
			{ parser: `babel`, arrowParens: `avoid`, semi: false, trailingComma: `none` }
		)
	}

	code = postprocess(code, uniqueId)

	if (includesIllegalString(code)) {
		throw Error(
			`you found a weird edge case where I wasn't able to replace illegal strings like "SC$", please report thx`
		)
	}

	return { script: code, warnings }
}

/* eslint-disable no-console, no-eval */
if (import.meta.vitest) {
	const DEBUG_LOG_PROCESSED_SCRIPTS = false
	const TESTS_FOLDER = `game-scripts-tests`
	const { test, expect } = import.meta.vitest

	const testFiles = await Promise.all(
		(await readFolder(TESTS_FOLDER, { withFileTypes: true }))
			.filter(dirent => dirent.isFile())
			.map(async dirent => {
				const filePath = getRelativePath(`.`, resolvePath(TESTS_FOLDER, dirent.name))
				const source = await readFile(filePath, `utf8`)

				const { script, warnings } =
					await processScript(source, { scriptName: getPathBasename(dirent.name), filePath, minify: false })

				return { filePath, script, warnings }
			})
	)

	for (const { filePath, script, warnings } of testFiles) {
		test(filePath, () => {
			if (DEBUG_LOG_PROCESSED_SCRIPTS)
				console.debug(`${filePath} processed script:\n${script}`)

			expect(warnings.length).toBe(0);
			(0, eval)(`(${script})`)(import.meta.vitest)
		})
	}

	test(`programmatic api works`, async () => {
		const source = `function () { #fs.scripts.trust() }`
		const processedScript = await processScript(source, { scriptName: true })

		expect(processedScript).toMatchSnapshot()
	})
}
