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
import babelTraverse, { NodePath } from "@babel/traverse"
import t, { BlockStatement, CallExpression, FunctionDeclaration, Identifier, Program } from "@babel/types"
import rollupPluginBabel_ from "@rollup/plugin-babel"
import rollupPluginCommonJS from "@rollup/plugin-commonjs"
import rollupPluginJSON from "@rollup/plugin-json"
import rollupPluginNodeResolve from "@rollup/plugin-node-resolve"
import { assert, ensure } from "@samual/lib/assert.js"
import { rollup } from "rollup"
import { supportedExtensions as extensions } from ".."

const { default: traverse } = babelTraverse as any as typeof import("@babel/traverse")
const { default: rollupPluginBabel } = rollupPluginBabel_ as any as typeof import("@rollup/plugin-babel")

export type CompileOptions = {
	/** 11 a-z 0-9 characters */
	uniqueID: string

	/** the unprocessed source code (defaults to the given `code` parameter) */
	sourceCode: string

	/** the user the script will be uploaded to (or set to `true` if it is not yet known) */
	scriptUser: string | true

	/** the name of this script (or set to `true` if it is not yet known) */
	scriptName: string | true

	seclevel: number
}

/**
 * @param code the preprocessed code to be compiled into hackmud compatible code
 * @param options {@link CompileOptions details}
 */
export async function compile(code: string, {
	uniqueID = "00000000000",
	sourceCode = code,
	scriptUser = "UNKNOWN",
	scriptName = "UNKNOWN",
	seclevel = -1
}: Partial<CompileOptions> = {}) {
	assert(uniqueID.match(/^\w{11}$/))

	const bundle = await rollup({
		plugins: [
			{
				name: "emit script",
				buildStart() {
					this.emitFile({
						type: "chunk",
						id: "script"
					})
				},
				resolveId(id) {
					if (id == "script")
						return id

					return null
				},
				load(id) {
					if (id == "script")
						return code

					return null
				}
			},
			rollupPluginCommonJS(),
			rollupPluginNodeResolve({ extensions }),
			rollupPluginJSON(),
			rollupPluginBabel({
				babelHelpers: "bundled",
				plugins: [
					[ babelPluginTransformTypescript.default ],
					[ babelPluginProposalDecorators.default, { decoratorsBeforeExport: true } ],
					[ babelPluginProposalDoExpressions.default ],
					[ babelPluginProposalFunctionBind.default ],
					[ babelPluginProposalFunctionSent.default ],
					[ babelPluginProposalPartialApplication.default ],
					[ babelPluginProposalPipelineOperator.default, { proposal: "hack", topicToken: "%" } ],
					[ babelPluginProposalThrowExpressions.default ],
					[ babelPluginProposalRecordAndTuple.default, { syntaxType: "hash" } ],
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
				configFile: false
			})
		]
	})

	code = (await bundle.generate({})).output[0].code

	const file = parse(code, { sourceType: "module" })
	const topFunctionName = `_SCRIPT_${uniqueID}_`
	const exports = new Map<string, string>()
	const liveExports = new Map<string, string>()

	let program!: NodePath<t.Program>

	traverse(file, {
		Program(path) {
			program = path
			path.skip()
		}
	})

	if (program.scope.hasGlobal("_START")) {
		for (const referencePath of getReferencePathsToGlobal("_START", program))
			referencePath.replaceWith(t.identifier("_ST"))
	}

	if (program.scope.hasGlobal("_TIMEOUT")) {
		for (const referencePath of getReferencePathsToGlobal("_START", program))
			referencePath.replaceWith(t.identifier("_TO"))
	}

	if (program.scope.hasGlobal("_SOURCE")) {
		for (const referencePath of getReferencePathsToGlobal("_SOURCE", program))
			referencePath.replaceWith(t.stringLiteral(sourceCode))
	}

	if (program.scope.hasGlobal("_BUILD_DATE")) {
		for (const referencePath of getReferencePathsToGlobal("_BUILD_DATE", program))
			referencePath.replaceWith(t.numericLiteral(Date.now()))
	}

	if (program.scope.hasGlobal("_SCRIPT_USER")) {
		for (const referencePath of getReferencePathsToGlobal("_SCRIPT_USER", program)) {
			if (scriptUser == true)
				referencePath.replaceWith(t.stringLiteral(`$${uniqueID}$SCRIPT_USER`))
			else
				referencePath.replaceWith(t.stringLiteral(scriptUser))
		}
	}

	if (program.scope.hasGlobal("_SCRIPT_NAME")) {
		for (const referencePath of getReferencePathsToGlobal("_SCRIPT_NAME", program)) {
			if (scriptName == true)
				referencePath.replaceWith(t.stringLiteral(`$${uniqueID}$SCRIPT_NAME`))
			else
				referencePath.replaceWith(t.stringLiteral(scriptName))
		}
	}

	if (program.scope.hasGlobal("_FULL_SCRIPT_NAME")) {
		for (const referencePath of getReferencePathsToGlobal("_FULL_SCRIPT_NAME", program)) {
			if (scriptUser == true || scriptName == true)
				referencePath.replaceWith(t.stringLiteral(`$${uniqueID}$FULL_SCRIPT_NAME`))
			else
				referencePath.replaceWith(t.stringLiteral(`${scriptUser}.${scriptName}`))
		}
	}

	// TODO warn when script name is invalid
	// TODO warn when not calling
	for (const fakeSubscriptObjectName of [ "$fs", "$hs", "$ms", "$ls", "$ns", "$4s", "$3s", "$2s", "$1s", "$0s" ]) {
		if (program.scope.hasGlobal(fakeSubscriptObjectName)) {
			for (const referencePath of getReferencePathsToGlobal(fakeSubscriptObjectName, program)) {
				assert(referencePath.parent.type == "MemberExpression")
				assert(referencePath.parent.property.type == "Identifier")
				assert(referencePath.parentPath.parentPath?.node.type == "MemberExpression")
				assert(referencePath.parentPath.parentPath?.node.property.type == "Identifier")

				// BUG this is causing typescript to be slow
				referencePath.parentPath.parentPath.replaceWith(
					t.identifier(`$${uniqueID}$SUBSCRIPT$${referencePath.parent.property.name}$${referencePath.parentPath.parentPath.node.property.name}`)
				)
			}
		}
	}

	// TODO warn when db method is invalid
	// TODO warn when not calling
	if (program.scope.hasGlobal("$db")) {
		for (const referencePath of getReferencePathsToGlobal("$db", program)) {
			assert(referencePath.parentPath.node.type == "MemberExpression")
			assert(referencePath.parentPath.node.property.type == "Identifier")

			referencePath.parentPath.replaceWith(
				t.identifier(`$${uniqueID}$DB$${referencePath.parentPath.node.property.name}`)
			)
		}
	}

	// TODO detect not being called and warn
	if (program.scope.hasGlobal("$D")) {
		for (const referencePath of getReferencePathsToGlobal("$D", program))
			referencePath.replaceWith(t.identifier(`$${uniqueID}$DEBUG`))
	}

	if (program.scope.hasGlobal("$FMCL")) {
		for (const referencePath of getReferencePathsToGlobal("$FMCL", program))
			referencePath.replaceWith(t.identifier(`$${uniqueID}$FMCL`))
	}

	if (program.scope.hasGlobal("$G")) {
		for (const referencePath of getReferencePathsToGlobal("$G", program))
			referencePath.replaceWith(t.identifier(`$${uniqueID}$GLOBAL`))
	}

	if (program.scope.hasGlobal("_SECLEVEL")) {
		for (const referencePath of getReferencePathsToGlobal("_SECLEVEL", program)) {
			referencePath.replaceWith(
				seclevel < 0
					? t.unaryExpression(
						"-",
						t.numericLiteral(-seclevel)
					)
					: t.numericLiteral(seclevel)
			)
		}
	}

	const globalBlock: BlockStatement = t.blockStatement([])
	let mainFunction: FunctionDeclaration | undefined
	const liveGlobalVariables: string[] = []

	for (const statement of program.node.body) {
		if (statement.type == "ExportDefaultDeclaration") {
			if (mainFunction) {
				globalBlock.body.push(
					t.variableDeclaration(
						"let",
						[
							t.variableDeclarator(
								mainFunction.id!,
								t.functionExpression(
									null,
									mainFunction.params,
									mainFunction.body,
									mainFunction.generator,
									mainFunction.async
								)
							)
						]
					)
				)
			}

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
			if (statement.declaration) {
				if (statement.declaration.type == "VariableDeclaration") {
					for (const declarator of statement.declaration.declarations) {
						assert(declarator.id.type == "Identifier", `global variable declarations using destructure syntax is currently unsupported`)

						if (statement.declaration.kind == "const")
							exports.set(declarator.id.name, declarator.id.name)
						else
							liveExports.set(declarator.id.name, declarator.id.name)

						globalBlock.body.push(
							t.variableDeclaration(
								"let",
								[ t.variableDeclarator(declarator.id, declarator.init) ]
							)
						)
					}
				} else {
					assert("id" in statement.declaration && statement.declaration.id, `unsupported export type "${statement.declaration.type}"`)

					const name = statement.declaration.id.type == "Identifier"
						? statement.declaration.id.name
						: statement.declaration.id.value

					exports.set(name, name)
					globalBlock.body.push(statement.declaration)
				}
			} else if (statement.specifiers) {
				for (const specifier of statement.specifiers) {
					assert(specifier.type == "ExportSpecifier", `${specifier.type} is currently unsupported`)

					const exportedName = specifier.exported.type == "Identifier"
						? specifier.exported.name
						: specifier.exported.value

					if (exportedName == "default") {
						if (mainFunction) {
							globalBlock.body.push(
								t.variableDeclaration(
									"let",
									[
										t.variableDeclarator(
											mainFunction.id!,
											t.functionExpression(
												null,
												mainFunction.params,
												mainFunction.body,
												mainFunction.generator,
												mainFunction.async
											)
										)
									]
								)
							)
						}

						mainFunction = t.functionDeclaration(
							t.identifier(topFunctionName),
							[
								t.identifier("context"),
								t.identifier("args")
							],
							t.blockStatement([
								t.returnStatement(
									t.callExpression(specifier.local, [])
								)
							])
						)
					} else if (liveGlobalVariables.includes(specifier.local.name)) {
						liveExports.set(
							specifier.local.name,
							exportedName
						)
					} else {
						exports.set(
							specifier.local.name,
							exportedName
						)
					}
				}
			}
		} else if (statement.type == "VariableDeclaration") {
			for (const declarator of statement.declarations) {
				assert(declarator.id.type == "Identifier", `global variable declarations using destructure syntax is currently unsupported`)

				if (statement.kind != "const") {
					if (exports.has(declarator.id.name)) {
						liveExports.set(declarator.id.name, exports.get(declarator.id.name)!)
						exports.delete(declarator.id.name)
					} else
						liveGlobalVariables.push(declarator.id.name)
				}

				globalBlock.body.push(
					t.variableDeclaration(
						"let",
						[ t.variableDeclarator(declarator.id, declarator.init) ]
					)
				)
			}
		} else if (statement.type == "FunctionDeclaration") {
			if (mainFunction || statement.async || statement.generator) {
				globalBlock.body.push(
					t.variableDeclaration(
						"let",
						[
							t.variableDeclarator(
								statement.id!,
								t.functionExpression(
									null,
									statement.params,
									statement.body,
									statement.generator,
									statement.async
								)
							)
						]
					)
				)
			} else
				mainFunction = statement

		} else
			globalBlock.body.push(statement)
	}

	mainFunction ||= t.functionDeclaration(
		t.identifier(topFunctionName),
		[
			t.identifier("context"),
			t.identifier("args")
		],
		t.blockStatement([])
	)

	program.node.body = [ mainFunction ]

	if (globalBlock.body.length) {
		program.scope.crawl()

		for (const [ globalBlockIndex, globalBlockStatement ] of globalBlock.body.entries()) {
			if (globalBlockStatement.type == "VariableDeclaration") {
				const declarator = globalBlockStatement.declarations[0]

				assert(declarator.id.type == "Identifier", `global variable declarations using destructure syntax is currently unsupported`)

				program.scope.crawl()

				if (program.scope.hasGlobal(declarator.id.name)) {
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

					const binding = program.scope.getBinding(declarator.id.name)

					assert(binding)

					for (const referencePath of binding.referencePaths) {
						assert(referencePath.node.type == "Identifier")

						referencePath.replaceWith(
							t.memberExpression(
								t.identifier(`$${uniqueID}$GLOBAL`),
								t.identifier(referencePath.node.name)
							)
						)
					}

					globalBlockPath.remove()
					globalBlockStatementPath.remove()

					if (declarator.init) {
						globalBlock.body.splice(
							globalBlockIndex,
							0,
							t.expressionStatement(
								t.assignmentExpression(
									"=",
									t.memberExpression(
										t.identifier(`$${uniqueID}$GLOBAL`),
										t.identifier(declarator.id.name)
									),
									declarator.init
								)
							)
						)
					}
				}
			} else if (globalBlockStatement.type == "ClassDeclaration") {
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
							t.memberExpression(
								t.identifier(`$${uniqueID}$GLOBAL`),
								t.identifier(referencePath.node.name)
							)
						)
					}

					globalBlockPath.remove()
					globalBlockStatementPath.remove()

					globalBlock.body.splice(
						globalBlockIndex,
						0,
						t.expressionStatement(
							t.assignmentExpression(
								"=",
								t.memberExpression(
									t.identifier(`$${uniqueID}$GLOBAL`),
									t.identifier(globalBlockStatement.id.name)
								),
								t.classExpression(
									null,
									globalBlockStatement.superClass,
									globalBlockStatement.body,
									globalBlockStatement.decorators
								)
							)
						)
					)
				}
			}
		}

		if (program.scope.hasGlobal("_EXPORTS")) {
			for (const referencePath of getReferencePathsToGlobal("_EXPORTS", program)) {
				referencePath.replaceWith(
					t.arrayExpression(
						[ ...exports.keys(), ...liveExports.keys() ]
							.map(name => t.stringLiteral(name))
					)
				)
			}
		}

		if (exports.size || liveExports.size) {
			globalBlock.body.push(
				t.expressionStatement(
					t.assignmentExpression(
						"=",
						t.memberExpression(
							t.identifier(`$${uniqueID}$GLOBAL`),
							t.identifier("_")
						),
						t.callExpression(
							t.memberExpression(
								t.identifier("Object"),
								t.identifier("freeze")
							),
							[
								t.objectExpression([
									...[ ...exports ].map(
										([ local, exported ]) =>
											t.objectProperty(t.identifier(exported), t.identifier(local))
									),
									...[ ...liveExports ].map(
										([ local, exported ]) => t.objectMethod(
											"get",
											t.identifier(exported),
											[],
											t.blockStatement([
												t.returnStatement(
													t.identifier(local)
												)
											])
										)
									)
								])
							]
						)
					)
				)
			)

			mainFunction.body.body.push(
				t.returnStatement(
					t.memberExpression(
						t.identifier(`$${uniqueID}$GLOBAL`),
						t.identifier("_")
					)
				)
			)
		}

		mainFunction.body.body.unshift(
			t.ifStatement(
				t.unaryExpression(
					"!",
					t.identifier(`$${uniqueID}$FMCL`)
				),
				globalBlock
			)
		)
	}

	traverse(file, {
		BlockStatement({ node: blockStatement }) {
			for (const [ i, functionDeclaration ] of blockStatement.body.entries()) {
				if (functionDeclaration.type != "FunctionDeclaration" || functionDeclaration.generator)
					continue

				blockStatement.body.splice(i, 1)

				blockStatement.body.unshift(
					t.variableDeclaration(
						"let",
						[
							t.variableDeclarator(
								functionDeclaration.id!,
								t.arrowFunctionExpression(
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

		ClassBody({ node: classBody, scope, parent }) {
			assert(t.isClass(parent))

			let thisIsReferenced = false

			for (const classMethod of classBody.body) {
				if (classMethod.type != "ClassMethod")
					continue

				let methodReferencesThis = false

				traverse(classMethod.body, {
					ThisExpression(path) {
						methodReferencesThis = true
						thisIsReferenced = true
						path.replaceWith(
							t.identifier(`_THIS_${uniqueID}_`)
						)
					},

					Function(path) {
						path.skip()
					}
				}, scope)

				if (!methodReferencesThis)
					continue

				if (classMethod.kind == "constructor") {
					const superCalls: NodePath<CallExpression>[] = []

					traverse(classMethod.body, {
						CallExpression(path) {
							if (path.node.callee.type == "Super")
								superCalls.push(path)
						}
					}, scope)

					if (!superCalls.length) {
						classMethod.body.body.unshift(
							t.variableDeclaration(
								"let",
								[
									t.variableDeclarator(
										t.identifier(`_THIS_${uniqueID}_`),
										t.callExpression(t.super(), [])
									)
								]
							)
						)
					} else if (superCalls.length == 1 && superCalls[0].parent.type == "ExpressionStatement" && superCalls[0].parentPath.parentPath!.parent == classMethod) {
						superCalls[0].parentPath.replaceWith(
							t.variableDeclaration(
								"let",
								[
									t.variableDeclarator(
										t.identifier(`_THIS_${uniqueID}_`),
										superCalls[0].node
									)
								]
							)
						)
					} else {
						for (const path of superCalls) {
							path.replaceWith(
								t.assignmentExpression(
									"=",
									t.identifier(`_THIS_${uniqueID}_`),
									path.node
								)
							)
						}

						classMethod.body.body.unshift(
							t.variableDeclaration(
								"let",
								[
									t.variableDeclarator(
										t.identifier(`_THIS_${uniqueID}_`)
									)
								]
							)
						)
					}

					continue
				}

				// BUG if the class or a super class overwrites `valueOf()` (or `Object.prototype` isn't even in the chain), this breaks
				// TODO track whether the class is extending a class that at some point extends from `Object` (if unsure, assume no)
				// TODO track whether any class in the chain overwrites `valueOf()` (if unsure, assume yes)
				// TODO for classes that need it, create a super class for this one to extend from with `valueOf()` assigned to an unused name

				classMethod.body.body.unshift(t.variableDeclaration(
					"let",
					[
						t.variableDeclarator(
							t.identifier(`_THIS_${uniqueID}_`),
							t.callExpression(
								t.memberExpression(
									t.super(),
									t.identifier("valueOf")
								),
								[]
							)
						)
					]
				))
			}

			if (!parent.superClass && thisIsReferenced)
				parent.superClass = t.identifier("Object")
		},

		VariableDeclaration({ node: variableDeclaration }) {
			if (variableDeclaration.kind == "const")
				variableDeclaration.kind = "let"
		},

		ThisExpression(path) {
			path.replaceWith(t.identifier(`_UNDEFINED_${uniqueID}_`))
		},

		BigIntLiteral(path) {
			const bigIntAsNumber = Number(path.node.value)

			if (BigInt(bigIntAsNumber) == BigInt(path.node.value)) {
				path.replaceWith(
					t.callExpression(
						t.identifier("BigInt"),
						[ t.numericLiteral(bigIntAsNumber) ]
					)
				)
			} else {
				path.replaceWith(
					t.callExpression(
						t.identifier("BigInt"),
						[ t.stringLiteral(path.node.value) ]
					)
				)
			}
		}
	})

	// TODO this should probably be done in the minify step
	// typescript does not like NodePath#get() and becomes very slow so I have to dance around it
	const mainFunctionScope = (program.get("body.0" as string) as NodePath<FunctionDeclaration>).scope

	for (const parameter of [ ...mainFunction.params ].reverse()) {
		if (parameter.type == "Identifier") {
			const binding = mainFunctionScope.getBinding(parameter.name)!

			if (!binding.referenced) {
				mainFunction.params.pop()
				continue
			}
		}

		break
	}

	// TODO this should be done in the minify step
	for (const global in (program.scope as any).globals as Record<string, any>) {
		if (global.startsWith(`$${uniqueID}`))
			continue

		const referencePaths = getReferencePathsToGlobal(global, program)

		if (5 + global.length + referencePaths.length >= global.length * referencePaths.length)
			continue

		for (const path of referencePaths)
			path.replaceWith(t.identifier(`_GLOBAL_${global}_${uniqueID}_`))

		mainFunction.body.body.unshift(
			t.variableDeclaration(
				"let",
				[
					t.variableDeclarator(
						t.identifier(`_GLOBAL_${global}_${uniqueID}_`),
						t.identifier(global)
					)
				]
			)
		)
	}

	return file
}

function getReferencePathsToGlobal(name: string, program: NodePath<Program>) {
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

export default compile
