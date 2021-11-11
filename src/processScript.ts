import babel from "@babel/core"
import babelGenerator from "@babel/generator"
import { Hub, NodePath } from "@babel/traverse"
import t, { BlockStatement, FunctionDeclaration, Identifier } from "@babel/types"
import { tokenizer as tokenize, tokTypes as tokenTypes } from "acorn"
import { minify } from "terser"
import { assert, ensure, hackmudLength, stringSplice } from "./lib"

const babelGenerate = (babelGenerator as any).default as typeof import("@babel/generator").default

/**
 * Minifies a given script
 *
 * @param script JavaScript or TypeScript code
 */
export async function processScript(script: string): Promise<{ srcLength: number,  script: string, warnings: { message: string, line: number }[] }> {
	let preScriptComments: string | undefined
	let autocomplete: string | undefined

	[ , preScriptComments, script, autocomplete ] = script.match(/((?:^\s*\/\/.*\n)*)\s*((?:.+?\/\/\s*(.+?)\s*$)?[^]*)/m)!

	if (script.match(/(?:SC|DB)\$/))
		throw new Error("SC$ and DB$ are protected and cannot appear in a script")

	let seclevel: number | undefined

	for (const line of preScriptComments.split("\n")) {
		let [ , autocompleteMatch, seclevelMatch ] = (line.match(/^\s*\/\/\s*(?:@autocomplete\s*([^\s].*?)|@seclevel\s*([^\s].*?))\s*$/) || []) as [ never, string | undefined, string | undefined ]

		if (autocompleteMatch)
			autocomplete = autocompleteMatch
		else if (seclevelMatch) {
			if (seclevelMatch.match(/^(?:fullsec|f|4|fs|full)$/i))
				seclevel = 4
			else if (seclevelMatch.match(/^(?:highsec|h|3|hs|high)$/i))
				seclevel = 3
			else if (seclevelMatch.match(/^(?:midsec|m|2|ms|mid)$/i))
				seclevel = 2
			else if (seclevelMatch.match(/^(?:lowsec|l|1|ls|low)$/i))
				seclevel = 1
			else if (seclevelMatch.match(/^(?:nullsec|n|0|ns|null)$/i))
				seclevel = 0
		}
	}

	let detectedSeclevel = 4

	if (script.match(/[#$][n0]s\.[a-z_][a-z_0-9]{0,24}\.[a-z_][a-z_0-9]{0,24}\(/))
		detectedSeclevel = 0
	else if (script.match(/[#$][l1]s\.[a-z_][a-z_0-9]{0,24}\.[a-z_][a-z_0-9]{0,24}\(/))
		detectedSeclevel = 1
	else if (script.match(/[#$][m2]s\.[a-z_][a-z_0-9]{0,24}\.[a-z_][a-z_0-9]{0,24}\(/))
		detectedSeclevel = 2
	else if (script.match(/[#$][h3]s\.[a-z_][a-z_0-9]{0,24}\.[a-z_][a-z_0-9]{0,24}\(/))
		detectedSeclevel = 3

	const seclevelNames = [ "NULLSEC", "LOWSEC", "MIDSEC", "HIGHSEC", "FULLSEC" ]

	if (seclevel == undefined)
		seclevel = detectedSeclevel
	else if (detectedSeclevel < seclevel)
		throw new Error(`detected seclevel ${seclevelNames[detectedSeclevel]} is lower than stated seclevel ${seclevelNames[seclevel]}`)

	const semicolons = script.match(/;/g)?.length ?? 0

	script = script
		.replace(/#[fhmln43210]s\.scripts\.quine\(\)/g, JSON.stringify(script))
		.replace(/[#$][fhmln43210]?s\.([a-z_][a-z_0-9]{0,24})\.([a-z_][a-z_0-9]{0,24})\(/g, "SC$$$1$$$2(")
		.replace(/^function\s*\(/, "function script(")
		.replace(/#D\(/g, "$D(")
		.replace(/#FMCL/g, "$FMCL")
		.replace(/#G/g, "$G")
		.replace(/[#$]db\./g, "DB$")

	const file = (await babel.transformAsync(script, {
		plugins: [
			"@babel/plugin-transform-typescript",
			[ "@babel/plugin-proposal-decorators", { decoratorsBeforeExport: true } ],
			"@babel/plugin-proposal-do-expressions",
			"@babel/plugin-proposal-function-bind",
			"@babel/plugin-proposal-function-sent",
			"@babel/plugin-proposal-partial-application",
			[ "@babel/plugin-proposal-pipeline-operator", { proposal: "hack", topicToken: "%" } ],
			"@babel/plugin-proposal-throw-expressions",
			[ "@babel/plugin-proposal-record-and-tuple", { syntaxType: "hash" } ],
			"@babel/plugin-proposal-class-properties",
			"@babel/plugin-proposal-class-static-block",
			"@babel/plugin-proposal-private-property-in-object",
			"@babel/plugin-proposal-logical-assignment-operators",
			"@babel/plugin-proposal-numeric-separator",
			"@babel/plugin-proposal-nullish-coalescing-operator",
			"@babel/plugin-proposal-optional-chaining",
			"@babel/plugin-proposal-optional-catch-binding",
			"@babel/plugin-proposal-json-strings",
			"@babel/plugin-proposal-object-rest-spread",
			"@babel/plugin-transform-exponentiation-operator"
		],
		code: false,
		ast: true,
		configFile: false
	}))!.ast!

	if (!file.program.body.length) {
		return {
			srcLength: 12,
			script: "function(){}",
			warnings: [ { message: "script is empty", line: 0 } ]
		}
	}

	const randomString = Math.floor(Math.random() * (2 ** 52)).toString(36)
	const topFunctionName = `_SCRIPT_${randomString}_`
	const exports: string[] = []

	const program = NodePath.get({
		container: file,
		hub: new Hub,
		key: "program",
		parent: file,
		parentPath: null
	})

	if (program.scope.hasGlobal("_START")) {
		for (const referencePath of getReferencePathsToGlobal("_START", program))
			referencePath.replaceWith(t.identifier("_ST"))
	}

	if (program.scope.hasGlobal("_TIMEOUT")) {
		for (const referencePath of getReferencePathsToGlobal("_START", program))
			referencePath.replaceWith(t.identifier("_TO"))
	}

	const globalBlock: BlockStatement = babel.types.blockStatement([])
	let mainFunction: FunctionDeclaration | undefined

	for (const statement of program.node.body) {
		if (statement.type == "ExportDefaultDeclaration") {
			if (statement.declaration.type == "FunctionDeclaration" || statement.declaration.type == "FunctionExpression" || statement.declaration.type == "ArrowFunctionExpression") {
				mainFunction = t.functionDeclaration(
					t.identifier(topFunctionName),
					statement.declaration.params,
					statement.declaration.body.type == "BlockStatement"
						? statement.declaration.body
						: t.blockStatement([ t.returnStatement(statement.declaration.body) ])
				)
			} else {
				assert(t.isExpression(statement.declaration))

				mainFunction = t.functionDeclaration(
					t.identifier(topFunctionName),
					[
						t.identifier("context"),
						t.identifier("args")
					],
					t.blockStatement([
						t.returnStatement(
							t.callExpression(statement.declaration, [])
						)
					])
				)
			}
		} else if (statement.type == "ExportNamedDeclaration") {
			assert(statement.declaration, "`export {}` syntax currently unsupported")

			if (statement.declaration.type == "VariableDeclaration") {
				for (const declarator of statement.declaration.declarations) {
					assert(declarator.id.type == "Identifier", `global variable declarations using destructure syntax is currently unsupported`)
					exports.push(declarator.id.name)

					globalBlock.body.push(
						t.variableDeclaration(
							"let",
							[ t.variableDeclarator(declarator.id, declarator.init) ]
						)
					)
				}
			} else {
				assert("id" in statement.declaration && statement.declaration.id, `unsupported export type "${statement.declaration.type}"`)

				exports.push(
					statement.declaration.id.type == "Identifier"
						? statement.declaration.id.name
						: statement.declaration.id.value
				)

				globalBlock.body.push(statement.declaration)
			}
		} else if (statement.type == "VariableDeclaration") {
			for (const declarator of statement.declarations) {
				globalBlock.body.push(
					t.variableDeclaration(
						"let",
						[ t.variableDeclarator(declarator.id, declarator.init) ]
					)
				)
			}
		} else
			globalBlock.body.push(statement)
	}

	mainFunction ||= babel.types.functionDeclaration(
		babel.types.identifier(topFunctionName),
		[
			babel.types.identifier("context"),
			babel.types.identifier("args")
		],
		babel.types.blockStatement([])
	)

	program.node.body = [ mainFunction ]

	program.scope.crawl()

	for (const [ globalBlockIndex, globalBlockStatement ] of globalBlock.body.entries()) {
		if (globalBlockStatement.type == "VariableDeclaration") {
			const declarator = globalBlockStatement.declarations[0]

			assert(declarator.id.type == "Identifier", `global variable declarations using destructure syntax is currently unsupported`)

			program.scope.crawl()

			if (program.scope.hasGlobal(declarator.id.name)) {
				globalBlock.body.splice(globalBlockIndex, 1)

				if (declarator.init) {
					globalBlock.body.splice(
						globalBlockIndex,
						0,
						babel.types.expressionStatement(
							babel.types.assignmentExpression(
								"=",
								babel.types.memberExpression(
									babel.types.identifier("$G"),
									babel.types.identifier(declarator.id.name)
								),
								declarator.init
							)
						)
					)
				}

				program.node.body.unshift(globalBlock)
				program.scope.crawl()

				for (const referencePath of getReferencePathsToGlobal(declarator.id.name, program)) {
					referencePath.replaceWith(
						babel.types.memberExpression(
							babel.types.identifier("$G"),
							babel.types.identifier(referencePath.node.name)
						)
					)
				}

				program.node.body.shift()
			}
		} else if (globalBlockStatement.type == "FunctionDeclaration") {
			assert(globalBlockStatement.id)

			program.scope.crawl()

			if (program.scope.hasGlobal(globalBlockStatement.id.name)) {
				globalBlock.body.splice(globalBlockIndex, 1)

				const [ globalBlockPath ] = program.unshiftContainer(
					"body",
					globalBlock
				)

				const [ globalBlockStatementPath ] = program.unshiftContainer(
					"body",
					globalBlockStatement
				)

				program.scope.crawl()

				const binding = program.scope.getBinding(globalBlockStatement.id.name)

				assert(binding)

				for (const referencePath of binding.referencePaths) {
					assert(referencePath.node.type == "Identifier")

					referencePath.replaceWith(
						babel.types.memberExpression(
							babel.types.identifier("$G"),
							babel.types.identifier(referencePath.node.name)
						)
					)
				}

				globalBlockPath.remove()
				globalBlockStatementPath.remove()

				globalBlock.body.splice(
					globalBlockIndex,
					0,
					babel.types.expressionStatement(
						babel.types.assignmentExpression(
							"=",
							babel.types.memberExpression(
								babel.types.identifier("$G"),
								babel.types.identifier(globalBlockStatement.id.name)
							),
							babel.types.functionExpression(
								null,
								globalBlockStatement.params,
								globalBlockStatement.body,
								globalBlockStatement.generator,
								globalBlockStatement.async
							)
						)
					)
				)
			}
		}
	}

	mainFunction.body.body.unshift(
		babel.types.ifStatement(
			babel.types.unaryExpression(
				"!",
				babel.types.identifier("$FMCL")
			),
			globalBlock
		)
	)

	const jsonValues: any[] = []

	let undefinedIsReferenced = false

	babel.traverse(file, {
		BlockStatement({ node: blockStatement }) {
			for (const [ i, functionDeclaration ] of blockStatement.body.entries()) {
				if (functionDeclaration.type != "FunctionDeclaration" || functionDeclaration.generator)
					continue

				blockStatement.body.splice(i, 1)

				blockStatement.body.unshift(
					babel.types.variableDeclaration(
						"let",
						[
							babel.types.variableDeclarator(
								functionDeclaration.id!,
								babel.types.arrowFunctionExpression(
									functionDeclaration.params,
									functionDeclaration.body,
									functionDeclaration.async
								)
							)
						]
					)
				)
			}
		},

		ClassBody({ node: classBody, scope }) {
			for (const classMethod of classBody.body) {
				if (classMethod.type != "ClassMethod")
					continue

				babel.traverse(classMethod.body, {
					ThisExpression(path) {
						path.replaceWith(
							babel.types.identifier(`_THIS_${randomString}_`)
						)
					}
				}, scope)

				if (classMethod.kind == "constructor") {
					babel.traverse(classMethod.body, {
						CallExpression(path) {
							if (path.node.callee.type != "Super")
								return

							path.replaceWith(
								babel.types.assignmentExpression(
									"=",
									babel.types.identifier(`_THIS_${randomString}_`),
									path.node
								)
							)

							path.skip()
						}
					}, scope)


					classMethod.body.body.unshift(
						babel.types.variableDeclaration(
							"let",
							[
								babel.types.variableDeclarator(
									babel.types.identifier(`_THIS_${randomString}_`)
								)
							]
						)
					)

					continue
				}

				classMethod.body.body.unshift(babel.types.variableDeclaration(
					"let",
					[
						babel.types.variableDeclarator(
							babel.types.identifier(`_THIS_${randomString}_`),
							babel.types.callExpression(
								babel.types.memberExpression(
									babel.types.super(),
									babel.types.identifier("valueOf")
								),
								[]
							)
						)
					]
				))
			}
		},

		VariableDeclaration({ node: variableDeclaration }) {
			if (variableDeclaration.kind == "const")
				variableDeclaration.kind = "let"
		},

		ThisExpression(path) {
			path.replaceWith(babel.types.identifier(`_UNDEFINED_${randomString}_`))
		},

		BigIntLiteral(path) {
			const bigIntAsNumber = Number(path.node.value)

			if (BigInt(bigIntAsNumber) == BigInt(path.node.value)) {
				path.replaceWith(
					babel.types.callExpression(
						babel.types.identifier("BigInt"),
						[ babel.types.numericLiteral(bigIntAsNumber) ]
					)
				)
			} else {
				path.replaceWith(
					babel.types.callExpression(
						babel.types.identifier("BigInt"),
						[ babel.types.stringLiteral(path.node.value) ]
					)
				)
			}
		}
	})

	script = babelGenerate(file!).code

	// the typescript inserts semicolons where they weren't already so we take
	// all semicolons out of the count and add the number of semicolons in the
	// source to make things fair
	let srcLength = hackmudLength(script.replace(/^function\s*\w+\(/, "function("))
		- (script.match(/;/g)?.length ?? 0)
		+ semicolons
		+ (script.match(/SC\$[a-zA-Z_][a-zA-Z0-9_]*\$[a-zA-Z_][a-zA-Z0-9_]*\(/g)?.length ?? 0)
		+ (script.match(/DB\$/g)?.length ?? 0)

	// remove dead code (so we don't waste chracters quine cheating strings
	// that aren't even used)
	script = (await minify(script, {
		ecma: 2015,
		parse: { bare_returns: true },
		compress: {
			passes: Infinity,
			unsafe: true,
			booleans: false,
			sequences: false
		}
	})).code || ""

	let scriptBeforeJSONValueReplacement

	{
		// BUG when this script is used, the source char count is off

		const file = await babel.parseAsync(script, { configFile: false }) as babel.types.File

		babel.traverse(file, {
			MemberExpression({ node: memberExpression }) {
				if (memberExpression.computed)
					return

				assert(memberExpression.property.type == "Identifier")

				if (memberExpression.property.name == "prototype") {
					memberExpression.computed = true
					memberExpression.property = babel.types.identifier(`_PROTOTYPE_PROPERTY_${randomString}_`)
				} else if (memberExpression.property.name == "__proto__") {
					memberExpression.computed = true
					memberExpression.property = babel.types.identifier(`_PROTO_PROPERTY_${randomString}_`)
				}
			}
		})

		scriptBeforeJSONValueReplacement = (await minify(babelGenerate(file!).code, {
			ecma: 2015,
			compress: {
				passes: Infinity,
				unsafe: true,
				unsafe_arrows: true,
				unsafe_comps: true,
				unsafe_symbols: true,
				unsafe_methods: true,
				unsafe_proto: true,
				unsafe_regexp: true,
				unsafe_undefined: true,
				sequences: false
			},
			format: { semicolons: false }
		})).code!
			.replace(new RegExp(`_PROTOTYPE_PROPERTY_${randomString}_`, "g"), `"prototype"`)
			.replace(new RegExp(`_PROTO_PROPERTY_${randomString}_`, "g"), `"__proto__"`)
	}

	let comment: string | null = null
	let hasComment = false

	{
		const file = await babel.parseAsync(script, { configFile: false }) as babel.types.File
		const promises: Promise<any>[] = []

		babel.traverse(file, {
			FunctionDeclaration(path) {
				path.traverse({
					Function(path) {
						if (path.parent.type != "CallExpression" && path.parentKey != "callee")
							path.skip()
					},

					Loop(path) {
						path.skip()
					},

					ObjectExpression(path) {
						const o: Record<string, unknown> = {}

						if (parseObjectExpression(path.node, o))
							path.replaceWith(babel.types.identifier(`_JSON_VALUE_${jsonValues.push(o) - 1}_${randomString}_`))
					},

					ArrayExpression(path) {
						const o: unknown[] = []

						if (parseArrayExpression(path.node, o))
							path.replaceWith(babel.types.identifier(`_JSON_VALUE_${jsonValues.push(o) - 1}_${randomString}_`))
					}
				})

				path.traverse({
					TemplateLiteral(path) {
						const templateLiteral = path.node
						let replacement: babel.Node = babel.types.stringLiteral(templateLiteral.quasis[0].value.cooked!)

						for (let i = 0; i < templateLiteral.expressions.length; i++) {
							const expression = templateLiteral.expressions[i] as babel.types.Expression
							const templateElement = templateLiteral.quasis[i + 1]

							replacement = babel.types.binaryExpression(
								"+",
								replacement,
								expression
							)

							if (!templateElement.value.cooked)
								continue

							replacement = babel.types.binaryExpression(
								"+",
								replacement,
								babel.types.stringLiteral(templateElement.value.cooked!)
							)
						}

						path.replaceWith(replacement)
					},

					MemberExpression({ node: memberExpression }) {
						if (memberExpression.computed)
							return

						assert(memberExpression.property.type == "Identifier")

						if (memberExpression.property.name.length < 3)
							return

						memberExpression.computed = true
						memberExpression.property = babel.types.stringLiteral(memberExpression.property.name)
					},

					UnaryExpression(path) {
						if (path.node.operator == "void" && path.node.argument.type == "NumericLiteral" && !path.node.argument.value) {
							path.replaceWith(babel.types.identifier(`_UNDEFINED_${randomString}_`))
							undefinedIsReferenced = true
						}
					},

					NullLiteral(path) {
						let jsonValueIndex = jsonValues.indexOf(null)

						if (jsonValueIndex == -1)
							jsonValueIndex += jsonValues.push(null)

						path.replaceWith(babel.types.identifier(`_JSON_VALUE_${jsonValueIndex}_${randomString}_`))
					},

					BooleanLiteral(path) {
						let jsonValueIndex = jsonValues.indexOf(path.node.value)

						if (jsonValueIndex == -1)
							jsonValueIndex += jsonValues.push(path.node.value)

						path.replaceWith(babel.types.identifier(`_JSON_VALUE_${jsonValueIndex}_${randomString}_`))
					},

					NumericLiteral(path) {
						promises.push((async () => {
							if ((await minifyNumber(path.node.value)).length <= 3)
								return

							if (path.parentKey == "key" && path.parent.type == "ObjectProperty")
								path.parent.computed = true

							let jsonValueIndex = jsonValues.indexOf(path.node.value)

							if (jsonValueIndex == -1)
								jsonValueIndex += jsonValues.push(path.node.value)

							path.replaceWith(babel.types.identifier(`_JSON_VALUE_${jsonValueIndex}_${randomString}_`))
						})())
					},

					StringLiteral(path) {
						if (path.node.value.includes("\u0000") || path.node.value.length < 2)
							return

						if (path.parentKey == "key" && path.parent.type == "ObjectProperty")
							path.parent.computed = true

						let jsonValueIndex = jsonValues.indexOf(path.node.value)

						if (jsonValueIndex == -1)
							jsonValueIndex += jsonValues.push(path.node.value)

						path.replaceWith(babel.types.identifier(`_JSON_VALUE_${jsonValueIndex}_${randomString}_`))
					},

					ObjectProperty({ node }) {
						if (node.computed || node.key.type != "Identifier" || node.key.name.length < 4)
							return

						let jsonValueIndex = jsonValues.indexOf(node.key.name)

						if (jsonValueIndex == -1)
							jsonValueIndex += jsonValues.push(node.key.name)

						node.computed = true
						node.key = babel.types.identifier(`_JSON_VALUE_${jsonValueIndex}_${randomString}_`)
					}
				})

				path.skip()
			}
		})

		await Promise.all(promises)

		const [ functionDeclaration ] = file.program.body

		assert(functionDeclaration.type == "FunctionDeclaration")

		if (jsonValues.length) {
			hasComment = true

			if (jsonValues.length == 1) {
				if (typeof jsonValues[0] == "string" && !jsonValues[0].includes("\n") && !jsonValues[0].includes("\t")) {
					const variableDeclaration = babel.types.variableDeclaration(
						"let",
						[
							babel.types.variableDeclarator(
								babel.types.identifier(`_JSON_VALUE_0_${randomString}_`),
								babel.types.memberExpression(
									babel.types.taggedTemplateExpression(
										babel.types.memberExpression(
											babel.types.callExpression(babel.types.identifier(`SC$scripts$quine`), []),
											babel.types.identifier("split")
										),
										babel.types.templateLiteral([ babel.types.templateElement({ raw: "\t", cooked: "\t" }, true) ], [])
									),
									babel.types.identifier(`_SPLIT_INDEX_${randomString}_`),
									true
								)
							)
						]
					)

					if (undefinedIsReferenced)
						variableDeclaration.declarations.push(babel.types.variableDeclarator(babel.types.identifier(`_UNDEFINED_${randomString}_`)))

					functionDeclaration.body.body.unshift(variableDeclaration)

					comment = jsonValues[0]
				} else {
					const variableDeclaration = babel.types.variableDeclaration(
						"let",
						[
							babel.types.variableDeclarator(
								babel.types.identifier(`_JSON_VALUE_0_${randomString}_`),
								babel.types.callExpression(
									babel.types.memberExpression(
										babel.types.identifier("JSON"),
										babel.types.identifier("parse")
									),
									[
										babel.types.memberExpression(
											babel.types.taggedTemplateExpression(
												babel.types.memberExpression(
													babel.types.callExpression(babel.types.identifier(`SC$scripts$quine`), []),
													babel.types.identifier("split")
												),
												babel.types.templateLiteral([ babel.types.templateElement({ raw: "\t", cooked: "\t" }, true) ], [])
											),
											babel.types.identifier(`_SPLIT_INDEX_${randomString}_`),
											true
										)
									]
								)
							)
						]
					)

					if (undefinedIsReferenced)
						variableDeclaration.declarations.push(babel.types.variableDeclarator(babel.types.identifier(`_UNDEFINED_${randomString}_`)))

					functionDeclaration.body.body.unshift(variableDeclaration)

					comment = JSON.stringify(jsonValues[0])
				}
			} else {
				const variableDeclaration = babel.types.variableDeclaration(
					"let",
					[
						babel.types.variableDeclarator(
							babel.types.arrayPattern(jsonValues.map((_, i) => babel.types.identifier(`_JSON_VALUE_${i}_${randomString}_`))),
							babel.types.callExpression(
								babel.types.memberExpression(
									babel.types.identifier("JSON"),
									babel.types.identifier("parse")
								),
								[
									babel.types.memberExpression(
										babel.types.taggedTemplateExpression(
											babel.types.memberExpression(
												babel.types.callExpression(babel.types.identifier(`SC$scripts$quine`), []),
												babel.types.identifier("split")
											),
											babel.types.templateLiteral([ babel.types.templateElement({ raw: "\t", cooked: "\t" }, true) ], [])
										),
										babel.types.identifier(`_SPLIT_INDEX_${randomString}_`),
										true
									)
								]
							)
						)
					]
				)

				if (undefinedIsReferenced)
					variableDeclaration.declarations.push(babel.types.variableDeclarator(babel.types.identifier(`_UNDEFINED_${randomString}_`)))

				functionDeclaration.body.body.unshift(variableDeclaration)

				comment = JSON.stringify(jsonValues)
			}
		} else if (undefinedIsReferenced) {
			functionDeclaration.body.body.unshift(
				babel.types.variableDeclaration(
					"let",
					[ babel.types.variableDeclarator(babel.types.identifier(`_UNDEFINED_${randomString}_`)) ]
				)
			)
		}

		script = babelGenerate(file!).code
	}

	script = (await minify(script, {
		ecma: 2015,
		compress: {
			passes: Infinity,
			unsafe: true,
			unsafe_arrows: true,
			unsafe_comps: true,
			unsafe_symbols: true,
			unsafe_methods: true,
			unsafe_proto: true,
			unsafe_regexp: true,
			unsafe_undefined: true,
			sequences: false
		},
		format: { semicolons: false }
	})).code || ""

	// this step affects the chracter count and can't be done after the count comparison
	if (comment != null) {
		script = stringSplice(script, `${autocomplete ? `//${autocomplete}\n` : ""}\n//\t${comment}\t\n`, getFunctionBodyStart(script) + 1)

		for (const [ i, part ] of script.split("\t").entries()) {
			if (part != comment)
				continue

			script = script.replace(`_SPLIT_INDEX_${randomString}_`, await minifyNumber(i))
			break
		}
	}

	// if the script has a comment, it's gonna contain `SC$scripts$quine()`
	// which is gonna eventually compile to `#fs.scripts.quine()` which contains
	// an extra character so we have to account for that
	if (hackmudLength(scriptBeforeJSONValueReplacement) <= (hackmudLength(script) + Number(hasComment))) {
		script = scriptBeforeJSONValueReplacement

		if (autocomplete)
			script = stringSplice(script, `//${autocomplete}\n`, getFunctionBodyStart(script) + 1)
	}

	script = script
		.replace(/^function\s*\w+\(/, "function(")
		.replace(/SC\$([a-zA-Z_][a-zA-Z0-9_]*)\$([a-zA-Z_][a-zA-Z0-9_]*)\(/g, `#${"nlmhf"[seclevel]}s.$1.$2(`)
		.replace(/\$D\(/g, "#D(")
		.replace(/\$FMCL/g, "#FMCL")
		.replace(/\$G/g, "#G")
		.replace(/DB\$/g, "#db.")

	return {
		srcLength,
		script,
		warnings: []
	}
}

async function minifyNumber(number: number) {
	return (await minify(`$(${number})`, { ecma: 2015 })).code!.match(/\$\((.+)\)/)![1]
}

function getFunctionBodyStart(code: string) {
	const tokens = tokenize(code, { ecmaVersion: 2015 })

	tokens.getToken() // function
	tokens.getToken() // name
	tokens.getToken() // (

	let nests = 1

	while (nests) {
		const token = tokens.getToken()

		if (token.type == tokenTypes.parenL)
			nests++
		else if (token.type == tokenTypes.parenR)
			nests--
	}

	return tokens.getToken().start // {
}

export default processScript

function parseObjectExpression(node: babel.types.ObjectExpression, o: Record<string, unknown>) {
	if (!node.properties.length)
		return false

	for (const property of node.properties) {
		if (property.type != "ObjectProperty" || property.computed)
			return false

		assert(property.key.type == "Identifier" || property.key.type == "NumericLiteral" || property.key.type == "StringLiteral")

		if (property.value.type == "ArrayExpression") {
			const childArray: unknown[] = []

			if (parseArrayExpression(property.value, childArray))
				o[property.key.type == "Identifier" ? property.key.name : property.key.value] = childArray
		} else if (property.value.type == "ObjectExpression") {
			const childObject: Record<string, unknown> = {}

			if (parseObjectExpression(property.value, childObject))
				o[property.key.type == "Identifier" ? property.key.name : property.key.value] = childObject
		} else if (property.value.type == "NullLiteral")
			o[property.key.type == "Identifier" ? property.key.name : property.key.value] = null
		else if (property.value.type == "BooleanLiteral" || property.value.type == "NumericLiteral" || property.value.type == "StringLiteral")
			o[property.key.type == "Identifier" ? property.key.name : property.key.value] = property.value.value
		else
			return false
	}

	return true
}

function parseArrayExpression(node: babel.types.ArrayExpression, o: unknown[]) {
	if (!node.elements.length)
		return false

	for (const element of node.elements) {
		if (!element)
			return false

		if (element.type == "ArrayExpression") {
			const childArray: unknown[] = []

			if (parseArrayExpression(element, childArray))
				childArray.push(childArray)
			else
				return false
		} else if (element.type == "ObjectExpression") {
			const childObject: Record<string, unknown> = {}

			if (parseObjectExpression(element, childObject))
				o.push(childObject)
			else
				return false
		} else if (element.type == "NullLiteral")
			o.push(null)
		else if (element.type == "BooleanLiteral" || element.type == "NumericLiteral" || element.type == "StringLiteral")
			o.push(element.value)
		else
			return false
	}

	return true
}

function getReferencePathsToGlobal(name: string, program: babel.NodePath<babel.types.Program>) {
	const [ variableDeclaration ] = program.unshiftContainer(
		"body",
		t.variableDeclaration(
			"let",
			[ t.variableDeclarator(t.identifier(name)) ]
		)
	)

	program.scope.crawl()

	const binding = ensure(program.scope.getBinding(name))

	variableDeclaration.remove()

	return binding.referencePaths as NodePath<Identifier>[]
}
