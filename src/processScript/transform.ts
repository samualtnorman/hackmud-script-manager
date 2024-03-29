import type { NodePath } from "@babel/traverse"
import babelTraverse from "@babel/traverse"
import type { BlockStatement, CallExpression, File, FunctionDeclaration } from "@babel/types"
import t from "@babel/types"
import { assert } from "@samual/lib/assert"
import { clearObject } from "@samual/lib/clearObject"
import { validDBMethods } from "../constants"
import { getReferencePathsToGlobal } from "./shared"

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const { default: traverse } = babelTraverse as any as typeof import("@babel/traverse")

export type TransformOptions = {
	/** 11 a-z 0-9 characters */
	uniqueID: string

	/** the user going to be hosting this script (or set to `true` if not yet known) */
	scriptUser: string | true

	/** the name of this script (or set to `true` if not yet known) */
	scriptName: string | true

	seclevel: number
}

const globalFunctionsUnder7Characters = [
	`Map`,
	`Set`,
	`Date`,
	`JSON`,
	`Math`,
	`Array`,
	`Error`,
	`isNaN`,
	`Number`,
	`Object`,
	`RegExp`,
	`String`,
	`Symbol`,
	`BigInt`
]

/**
 * transform a given babel `File` to be hackmud compatible
 *
 * (returned File will need `postprocess()`ing)
 *
 * @param file babel ast node representing a file containing preprocessed code
 * @param sourceCode the original untouched source code
 * @param options {@link TransformOptions details}
 */
export const transform = (file: File, sourceCode: string, {
	uniqueID = `00000000000`,
	scriptUser = `UNKNOWN`,
	scriptName = `UNKNOWN`,
	seclevel = 4
}: Partial<TransformOptions> = {}) => {
	const topFunctionName = `_${uniqueID}_SCRIPT_`
	const exports = new Map<string, string>()
	const liveExports = new Map<string, string>()
	let program!: NodePath<t.Program>

	traverse(file, {
		Program(path) {
			program = path
			path.skip()
		}
	})

	if (program.scope.hasGlobal(`_SOURCE`)) {
		for (const referencePath of getReferencePathsToGlobal(`_SOURCE`, program))
			referencePath.replaceWith(t.stringLiteral(sourceCode))
	}

	if (program.scope.hasGlobal(`_BUILD_DATE`)) {
		for (const referencePath of getReferencePathsToGlobal(`_BUILD_DATE`, program))
			referencePath.replaceWith(t.numericLiteral(Date.now()))
	}

	if (program.scope.hasGlobal(`_SCRIPT_USER`)) {
		for (const referencePath of getReferencePathsToGlobal(`_SCRIPT_USER`, program)) {
			if (scriptUser == true)
				referencePath.replaceWith(t.stringLiteral(`$${uniqueID}$SCRIPT_USER$`))
			else
				referencePath.replaceWith(t.stringLiteral(scriptUser))
		}
	}

	if (program.scope.hasGlobal(`_SCRIPT_NAME`)) {
		for (const referencePath of getReferencePathsToGlobal(`_SCRIPT_NAME`, program)) {
			if (scriptName == true)
				referencePath.replaceWith(t.stringLiteral(`$${uniqueID}$SCRIPT_NAME$`))
			else
				referencePath.replaceWith(t.stringLiteral(scriptName))
		}
	}

	if (program.scope.hasGlobal(`_FULL_SCRIPT_NAME`)) {
		for (const referencePath of getReferencePathsToGlobal(`_FULL_SCRIPT_NAME`, program)) {
			if (scriptUser == true || scriptName == true)
				referencePath.replaceWith(t.stringLiteral(`$${uniqueID}$FULL_SCRIPT_NAME$`))
			else
				referencePath.replaceWith(t.stringLiteral(`${scriptUser}.${scriptName}`))
		}
	}

	let functionDotPrototypeIsReferencedMultipleTimes = false

	const createGetFunctionPrototypeNode = () => {
		for (const globalFunction of globalFunctionsUnder7Characters) {
			if (program.scope.hasOwnBinding(globalFunction))
				continue

			return t.memberExpression(
				t.memberExpression(
					t.identifier(globalFunction),
					t.identifier(`constructor`)
				),
				t.identifier(`prototype`)
			)
		}

		return t.memberExpression(
			t.memberExpression(
				t.arrowFunctionExpression(
					[ t.identifier(`_`) ],
					t.identifier(`_`)
				),
				t.identifier(`constructor`)
			),
			t.identifier(`prototype`)
		)
	}

	if (program.scope.hasGlobal(`Function`)) {
		const FunctionReferencePaths = getReferencePathsToGlobal(`Function`, program)

		if (FunctionReferencePaths.length == 1) {
			const referencePath = FunctionReferencePaths[0]!

			assert(referencePath.parent.type == `MemberExpression`, `\`Function\` isn't available in hackmud, only \`Function.prototype\` is accessible`)
			assert(referencePath.parent.property.type == `Identifier`, `\`Function\` isn't available in hackmud, only \`Function.prototype\` is accessible`)
			assert(referencePath.parent.property.name == `prototype`, `\`Function\` isn't available in hackmud, only \`Function.prototype\` is accessible`)
			referencePath.parentPath.replaceWith(createGetFunctionPrototypeNode())
		} else {
			for (const referencePath of FunctionReferencePaths) {
				assert(referencePath.parent.type == `MemberExpression`, `\`Function\` isn't available in hackmud, only \`Function.prototype\` is accessible`)
				assert(referencePath.parent.property.type == `Identifier`, `\`Function\` isn't available in hackmud, only \`Function.prototype\` is accessible`)
				assert(referencePath.parent.property.name == `prototype`, `\`Function\` isn't available in hackmud, only \`Function.prototype\` is accessible`)
				functionDotPrototypeIsReferencedMultipleTimes = true

				referencePath.parentPath.replaceWith(
					t.identifier(`_${uniqueID}_FUNCTION_DOT_PROTOTYPE_`)
				)
			}

			functionDotPrototypeIsReferencedMultipleTimes = true
		}
	}

	let detectedSeclevel = 4

	const processFakeSubscriptObject = (fakeSubscriptObjectName: string) => {
		for (const referencePath of getReferencePathsToGlobal(fakeSubscriptObjectName, program)) {
			assert(referencePath.parent.type == `MemberExpression`)
			assert(referencePath.parent.property.type == `Identifier`)
			assert(referencePath.parentPath.parentPath?.node.type == `MemberExpression`)
			assert(referencePath.parentPath.parentPath.node.property.type == `Identifier`)
			assert(/^[_a-z][\d_a-z]{0,24}$/.test(referencePath.parent.property.name), `invalid user "${referencePath.parent.property.name}" in subscript`)
			assert(/^[_a-z][\d_a-z]{0,24}$/.test(referencePath.parentPath.parentPath.node.property.name), `invalid script name "${referencePath.parentPath.parentPath.node.property.name}" in subscript`)

			if (referencePath.parentPath.parentPath.parentPath?.type == `CallExpression`) {
				// BUG this is causing typescript to be slow
				referencePath.parentPath.parentPath.replaceWith(
					t.identifier(`$${uniqueID}$SUBSCRIPT$${referencePath.parent.property.name}$${referencePath.parentPath.parentPath.node.property.name}$`)
				)
			} else {
				// BUG this is causing typescript to be slow
				referencePath.parentPath.parentPath.replaceWith(
					t.arrowFunctionExpression(
						[ t.restElement(t.identifier(`args`)) ],
						t.callExpression(
							t.identifier(`$${uniqueID}$SUBSCRIPT$${referencePath.parent.property.name}$${referencePath.parentPath.parentPath.node.property.name}$`),
							[ t.spreadElement(t.identifier(`args`)) ]
						)
					)
				)
			}
		}
	}

	for (const fakeSubscriptObjectName of [ `$fs`, `$4s`, `$s` ]) {
		if (program.scope.hasGlobal(fakeSubscriptObjectName))
			processFakeSubscriptObject(fakeSubscriptObjectName)
	}

	for (const fakeSubscriptObjectName of [ `$hs`, `$3s` ]) {
		if (program.scope.hasGlobal(fakeSubscriptObjectName)) {
			detectedSeclevel = 3
			processFakeSubscriptObject(fakeSubscriptObjectName)
		}
	}

	for (const fakeSubscriptObjectName of [ `$ms`, `$2s` ]) {
		if (program.scope.hasGlobal(fakeSubscriptObjectName)) {
			detectedSeclevel = 2
			processFakeSubscriptObject(fakeSubscriptObjectName)
		}
	}

	for (const fakeSubscriptObjectName of [ `$ls`, `$1s` ]) {
		if (program.scope.hasGlobal(fakeSubscriptObjectName)) {
			detectedSeclevel = 1
			processFakeSubscriptObject(fakeSubscriptObjectName)
		}
	}

	for (const fakeSubscriptObjectName of [ `$ns`, `$0s` ]) {
		if (program.scope.hasGlobal(fakeSubscriptObjectName)) {
			detectedSeclevel = 0
			processFakeSubscriptObject(fakeSubscriptObjectName)
		}
	}

	seclevel = Math.min(seclevel, detectedSeclevel)

	if (program.scope.hasGlobal(`$db`)) {
		for (const referencePath of getReferencePathsToGlobal(`$db`, program)) {
			assert(referencePath.parentPath.node.type == `MemberExpression`)
			assert(referencePath.parentPath.node.property.type == `Identifier`)

			const databaseOpMethodName = referencePath.parentPath.node.property.name

			assert(validDBMethods.includes(databaseOpMethodName), `invalid db method "${databaseOpMethodName}", valid db methods are "${validDBMethods.join(`", "`)}"`)

			if (referencePath.parentPath.parentPath?.type == `CallExpression`)
				referencePath.parentPath.replaceWith(t.identifier(`$${uniqueID}$DB$${databaseOpMethodName}$`))
			else if (databaseOpMethodName == `ObjectId`) {
				referencePath.parentPath.replaceWith(
					t.arrowFunctionExpression(
						[],
						t.callExpression(
							t.identifier(`$${uniqueID}$DB$${databaseOpMethodName}$`),
							[]
						)
					)
				)
			} else if (databaseOpMethodName == `i` || databaseOpMethodName == `r`) {
				referencePath.parentPath.replaceWith(
					t.arrowFunctionExpression(
						[ t.identifier(`a`) ],
						t.callExpression(
							t.identifier(`$${uniqueID}$DB$${databaseOpMethodName}$`),
							[ t.identifier(`a`) ]
						)
					)
				)
			} else {
				referencePath.parentPath.replaceWith(
					t.arrowFunctionExpression(
						[ t.identifier(`a`), t.identifier(`b`) ],
						t.callExpression(
							t.identifier(`$${uniqueID}$DB$${databaseOpMethodName}$`),
							[ t.identifier(`a`), t.identifier(`b`) ]
						)
					)
				)
			}
		}
	}

	if (program.scope.hasGlobal(`$D`)) {
		for (const referencePath of getReferencePathsToGlobal(`$D`, program)) {
			if (referencePath.parentPath.type == `CallExpression`)
				referencePath.replaceWith(t.identifier(`$${uniqueID}$DEBUG$`))
			else {
				referencePath.replaceWith(
					t.arrowFunctionExpression(
						[ t.identifier(`a`) ],
						t.callExpression(
							t.identifier(`$${uniqueID}$DEBUG$`),
							[ t.identifier(`a`) ]
						)
					)
				)
			}
		}
	}

	if (program.scope.hasGlobal(`$FMCL`)) {
		for (const referencePath of getReferencePathsToGlobal(`$FMCL`, program))
			referencePath.replaceWith(t.identifier(`$${uniqueID}$FMCL$`))
	}

	if (program.scope.hasGlobal(`$G`)) {
		for (const referencePath of getReferencePathsToGlobal(`$G`, program))
			referencePath.replaceWith(t.identifier(`$${uniqueID}$GLOBAL$`))
	}

	if (program.scope.hasGlobal(`_SECLEVEL`)) {
		for (const referencePath of getReferencePathsToGlobal(`_SECLEVEL`, program))
			referencePath.replaceWith(t.numericLiteral(seclevel))
	}

	let needGetPrototypeOf = false
	let needSetPrototypeOf = false

	if (program.scope.hasGlobal(`Object`)) {
		for (const referencePath of getReferencePathsToGlobal(`Object`, program)) {
			if (referencePath.parent.type != `MemberExpression` || referencePath.parent.computed)
				continue

			assert(referencePath.parent.property.type == `Identifier`)

			if (referencePath.parent.property.name == `getPrototypeOf`) {
				referencePath.parentPath.replaceWith(t.identifier(`_${uniqueID}_GET_PROTOTYPE_OF_`))
				needGetPrototypeOf = true
			} else if (referencePath.parent.property.name == `setPrototypeOf`) {
				referencePath.parentPath.replaceWith(t.identifier(`_${uniqueID}_SET_PROTOTYPE_OF_`))
				needSetPrototypeOf = true
			}
		}
	}

	// rollup removes all the inline exports and places a statement at the end instead
	const lastStatement = program.node.body.at(-1)
	let exportDefaultName

	assert(lastStatement, `program is empty`)

	if (lastStatement.type == `ExportNamedDeclaration`) {
		program.node.body.pop()

		for (const specifier of lastStatement.specifiers) {
			assert(specifier.type == `ExportSpecifier`, `${specifier.type} is currently unsupported`)

			const exportedName = specifier.exported.type == `Identifier`
				? specifier.exported.name
				: specifier.exported.value

			if (exportedName == `default`)
				exportDefaultName = specifier.local.name
			else
				exports.set(specifier.local.name, exportedName)
		}
	}

	const globalBlock: BlockStatement = t.blockStatement([])
	let mainFunction: FunctionDeclaration | undefined

	for (const statement of program.node.body) {
		if (statement.type == `VariableDeclaration`) {
			for (const declarator of statement.declarations) {
				if (declarator.id.type == `Identifier` && declarator.id.name == exportDefaultName && declarator.init && (declarator.init.type == `FunctionExpression` || declarator.init.type == `ArrowFunctionExpression`) && !declarator.init.async && !declarator.init.generator) {
					mainFunction = t.functionDeclaration(
						t.identifier(topFunctionName),
						declarator.init.params,
						declarator.init.body.type == `BlockStatement`
							? declarator.init.body
							: t.blockStatement([ t.returnStatement(declarator.init.body) ])
					)

					continue
				}

				for (const identifierName in t.getBindingIdentifiers(declarator.id)) {
					if (identifierName == exportDefaultName) {
						mainFunction = t.functionDeclaration(
							t.identifier(topFunctionName),
							[ t.identifier(`context`), t.identifier(`args`) ],
							t.blockStatement([
								t.returnStatement(
									t.callExpression(t.identifier(exportDefaultName), [])
								)
							])
						)
					}

					if (statement.kind != `const` && exports.has(identifierName)) {
						liveExports.set(identifierName, exports.get(identifierName)!)
						exports.delete(identifierName)
					}

					globalBlock.body.push(
						t.variableDeclaration(
							`let`,
							[ t.variableDeclarator(t.identifier(identifierName)) ]
						)
					)
				}

				if (declarator.init) {
					globalBlock.body.push(
						t.expressionStatement(
							t.assignmentExpression(
								`=`,
								declarator.id,
								declarator.init
							)
						)
					)
				}
			}
		} else if (statement.type == `FunctionDeclaration`) {
			if (statement.id!.name == exportDefaultName)
				mainFunction = statement
			else {
				globalBlock.body.push(
					t.variableDeclaration(
						`let`,
						[
							t.variableDeclarator(
								statement.id!,
								t.functionExpression(
									undefined,
									statement.params,
									statement.body,
									statement.generator,
									statement.async
								)
							)
						]
					)
				)
			}
		} else
			globalBlock.body.push(statement)
	}

	mainFunction ||= t.functionDeclaration(
		t.identifier(topFunctionName),
		[
			t.identifier(`context`),
			t.identifier(`args`)
		],
		t.blockStatement([])
	)

	program.node.body = [ mainFunction ]

	if (globalBlock.body.length) {
		if (exports.size || liveExports.size) {
			mainFunction.body.body.push(
				t.returnStatement(
					t.objectExpression([
						...[ ...exports ].map(
							([ local, exported ]) =>
								t.objectProperty(t.identifier(exported), t.identifier(local))
						),
						...[ ...liveExports ].map(
							([ local, exported ]) => t.objectMethod(
								`get`,
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
				)
			)
		}

		program.scope.crawl()

		const globalBlockVariables = new Set<string>()
		let hoistedGlobalBlockFunctions = 0

		for (const [ globalBlockIndex, globalBlockStatement ] of [ ...globalBlock.body.entries() ].reverse()) {
			if (globalBlockStatement.type == `VariableDeclaration`) {
				assert(globalBlockStatement.declarations.length == 1)

				const declarator = globalBlockStatement.declarations[0]!

				assert(declarator.id.type == `Identifier`, `declarator.id.type was "${declarator.id.type}"`)
				program.scope.crawl()

				if (program.scope.hasGlobal(declarator.id.name)) {
					globalBlock.body.splice(globalBlockIndex, 1)

					const [ globalBlockPath ] = program.unshiftContainer(
						`body`,
						globalBlock
					)

					const [ globalBlockStatementPath ] = program.unshiftContainer(
						`body`,
						globalBlockStatement
					)

					program.scope.crawl()

					if (!declarator.init || (declarator.init.type != `FunctionExpression` && declarator.init.type != `ArrowFunctionExpression`) || Object.keys((program.scope as any).globals).some(global => globalBlockVariables.has(global))) {
						const binding = program.scope.getBinding(declarator.id.name)

						assert(binding)

						for (const referencePath of binding.referencePaths) {
							assert(referencePath.node.type == `Identifier`)

							referencePath.replaceWith(
								t.memberExpression(
									t.identifier(`$${uniqueID}$GLOBAL$`),
									t.identifier(referencePath.node.name)
								)
							)
						}

						for (const referencePath of binding.constantViolations) {
							if (referencePath.node.type != `AssignmentExpression`)
								continue

							for (const [ name, node ] of Object.entries(t.getBindingIdentifiers(referencePath.node))) {
								if (name == declarator.id.name) {
									clearObject(node)

									Object.assign(
										node,
										t.memberExpression(
											t.identifier(`$${uniqueID}$GLOBAL$`),
											t.identifier(name)
										)
									)
								}
							}
						}

						globalBlockPath.remove()
						globalBlockStatementPath.remove()

						if (declarator.init) {
							globalBlock.body.splice(
								globalBlockIndex,
								0,
								t.expressionStatement(
									t.assignmentExpression(
										`=`,
										t.memberExpression(
											t.identifier(`$${uniqueID}$GLOBAL$`),
											t.identifier(declarator.id.name)
										),
										declarator.init
									)
								)
							)
						}
					} else {
						globalBlockPath.remove()
						globalBlockStatementPath.remove()

						mainFunction.body.body.unshift(
							globalBlockStatement
						)

						hoistedGlobalBlockFunctions++
					}
				} else
					globalBlockVariables.add(declarator.id.name)
			} else if (globalBlockStatement.type == `ClassDeclaration`) {
				program.scope.crawl()
				assert(globalBlockStatement.id, HERE)

				if (program.scope.hasGlobal(globalBlockStatement.id.name)) {
					globalBlock.body.splice(globalBlockIndex, 1)

					const [ globalBlockPath ] = program.unshiftContainer(
						`body`,
						globalBlock
					)

					const [ globalBlockStatementPath ] = program.unshiftContainer(
						`body`,
						globalBlockStatement
					)

					program.scope.crawl()

					const binding = program.scope.getBinding(globalBlockStatement.id.name)

					assert(binding)

					for (const referencePath of binding.referencePaths) {
						assert(referencePath.node.type == `Identifier`)

						referencePath.replaceWith(
							t.memberExpression(
								t.identifier(`$${uniqueID}$GLOBAL$`),
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
								`=`,
								t.memberExpression(
									t.identifier(`$${uniqueID}$GLOBAL$`),
									t.identifier(globalBlockStatement.id.name)
								),
								t.classExpression(
									undefined,
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

		if (program.scope.hasGlobal(`_EXPORTS`)) {
			for (const referencePath of getReferencePathsToGlobal(`_EXPORTS`, program)) {
				referencePath.replaceWith(
					t.arrayExpression(
						[ ...exports.keys(), ...liveExports.keys() ]
							.map(name => t.stringLiteral(name))
					)
				)
			}
		}

		if (globalBlock.body.length) {
			mainFunction.body.body.splice(
				hoistedGlobalBlockFunctions,
				0,
				t.ifStatement(
					t.unaryExpression(
						`!`,
						t.identifier(`$${uniqueID}$FMCL$`)
					),
					globalBlock
				)
			)
		}
	}

	if (functionDotPrototypeIsReferencedMultipleTimes) {
		mainFunction.body.body.unshift(t.variableDeclaration(`let`, [
			t.variableDeclarator(
				t.identifier(`_${uniqueID}_FUNCTION_DOT_PROTOTYPE_`),
				createGetFunctionPrototypeNode()
			)
		]))
	}

	if (needSetPrototypeOf) {
		mainFunction.body.body.unshift(t.variableDeclaration(`let`, [
			t.variableDeclarator(
				t.identifier(`_${uniqueID}_SET_PROTOTYPE_OF_`),
				t.callExpression(
					t.memberExpression(
						t.memberExpression(
							t.identifier(`Object`),
							t.identifier(`call`)
						),
						t.identifier(`bind`)
					),
					[ t.identifier(`_${uniqueID}_DUNDER_PROTO_SETTER_`) ]
				)
			)
		]))
	}

	if (needGetPrototypeOf) {
		mainFunction.body.body.unshift(t.variableDeclaration(`let`, [
			t.variableDeclarator(
				t.identifier(`_${uniqueID}_GET_PROTOTYPE_OF_`),
				t.callExpression(
					t.memberExpression(
						t.memberExpression(
							t.identifier(`Object`),
							t.identifier(`call`)
						),
						t.identifier(`bind`)
					),
					[ t.identifier(`_${uniqueID}_DUNDER_PROTO_GETTER_`) ]
				)
			)
		]))
	}

	if (needGetPrototypeOf || needSetPrototypeOf) {
		mainFunction.body.body.unshift(t.variableDeclaration(`let`, [
			t.variableDeclarator(
				t.objectPattern(needGetPrototypeOf
					? (needSetPrototypeOf
						? [
							t.objectProperty(
								t.identifier(`get`),
								t.identifier(`_${uniqueID}_DUNDER_PROTO_GETTER_`)
							),
							t.objectProperty(
								t.identifier(`set`),
								t.identifier(`_${uniqueID}_DUNDER_PROTO_SETTER_`)
							)
						]
						: [
							t.objectProperty(
								t.identifier(`get`),
								t.identifier(`_${uniqueID}_DUNDER_PROTO_GETTER_`)
							)
						]
					) : [
						t.objectProperty(
							t.identifier(`set`),
							t.identifier(`_${uniqueID}_DUNDER_PROTO_SETTER_`)
						)
					]
				),
				t.callExpression(
					t.memberExpression(
						t.identifier(`Object`),
						t.identifier(`getOwnPropertyDescriptor`)
					),
					[
						t.memberExpression(
							t.identifier(`Object`),
							t.identifier(`prototype`)
						),
						t.stringLiteral(`__proto__`)
					]
				)
			)
		]))
	}

	traverse(file, {
		BlockStatement({ node: blockStatement }) {
			for (const [ index, functionDeclaration ] of blockStatement.body.entries()) {
				if (functionDeclaration.type != `FunctionDeclaration` || functionDeclaration.generator)
					continue

				blockStatement.body.splice(index, 1)

				blockStatement.body.unshift(
					t.variableDeclaration(
						`let`,
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

			let thisIsReferenced = false as boolean

			for (const classMethod of classBody.body) {
				if (classMethod.type != `ClassMethod`)
					continue

				let methodReferencesThis = false as boolean

				traverse(classMethod.body, {
					ThisExpression(path) {
						methodReferencesThis = true
						thisIsReferenced = true
						path.replaceWith(t.identifier(`_${uniqueID}_THIS_`))
					},

					Function(path) {
						path.skip()
					}
				}, scope)

				if (!methodReferencesThis)
					continue

				if (classMethod.kind == `constructor`) {
					const superCalls: NodePath<CallExpression>[] = []

					traverse(classMethod.body, {
						CallExpression(path) {
							if (path.node.callee.type == `Super`)
								superCalls.push(path)
						}
					}, scope)

					if (!superCalls.length) {
						classMethod.body.body.unshift(
							t.variableDeclaration(
								`let`,
								[
									t.variableDeclarator(
										t.identifier(`_${uniqueID}_THIS_`),
										t.callExpression(t.super(), [])
									)
								]
							)
						)
					} else if (superCalls.length == 1 && superCalls[0]!.parent.type == `ExpressionStatement` && superCalls[0]!.parentPath.parentPath!.parent == classMethod) {
						superCalls[0]!.parentPath.replaceWith(
							t.variableDeclaration(
								`let`,
								[
									t.variableDeclarator(
										t.identifier(`_${uniqueID}_THIS_`),
										superCalls[0]!.node
									)
								]
							)
						)
					} else {
						for (const path of superCalls) {
							path.replaceWith(
								t.assignmentExpression(
									`=`,
									t.identifier(`_${uniqueID}_THIS_`),
									path.node
								)
							)
						}

						classMethod.body.body.unshift(
							t.variableDeclaration(
								`let`,
								[
									t.variableDeclarator(
										t.identifier(`_${uniqueID}_THIS_`)
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
					`let`,
					[
						t.variableDeclarator(
							t.identifier(`_${uniqueID}_THIS_`),
							t.callExpression(
								t.memberExpression(
									t.super(),
									t.identifier(`valueOf`)
								),
								[]
							)
						)
					]
				))
			}

			if (!parent.superClass && thisIsReferenced)
				parent.superClass = t.identifier(`Object`)
		},

		VariableDeclaration({ node: variableDeclaration }) {
			if (variableDeclaration.kind == `const`)
				variableDeclaration.kind = `let`
		},

		ThisExpression(path) {
			path.replaceWith(t.identifier(`undefined`))
		},

		BigIntLiteral(path) {
			const bigIntAsNumber = Number(path.node.value)

			if (BigInt(bigIntAsNumber) == BigInt(path.node.value)) {
				path.replaceWith(
					t.callExpression(
						t.identifier(`BigInt`),
						[ t.numericLiteral(bigIntAsNumber) ]
					)
				)
			} else {
				path.replaceWith(
					t.callExpression(
						t.identifier(`BigInt`),
						[ t.stringLiteral(path.node.value) ]
					)
				)
			}
		}
	})

	return { file, seclevel }
}

export default transform
