import babelGenerator from "@babel/generator"
import { parse } from "@babel/parser"
import babelTraverse from "@babel/traverse"
import t, { Expression } from "@babel/types"
import { assert, getHackmudCharacterCount, spliceString } from "@samual/lib"
import { tokenizer as tokenize, tokTypes as tokenTypes } from "acorn"
import * as terser from "terser"

const { default: generate } = babelGenerator as any as typeof import("@babel/generator")
const { default: traverse } = babelTraverse as any as typeof import("@babel/traverse")

// TODO when there are more than 3 references to `$G`, place a `let _GLOBAL_0_ = $G` at the top and replace references with `_GLOBAL_0_`
// TODO move autocomplete stuff outside this function
// TODO allow not mangling class and function names

/**
 * @param code compiled code and/or hackmud compatible code
 * @param autocomplete the comment inserted after the function signature
 * @param uniqueID 11 a-z 0-9 characters
 */
export async function minify(code: string, autocomplete: string, uniqueID = "00000000000") {
	assert(uniqueID.match(/^\w{11}$/))

	const jsonValues: any[] = []
	let undefinedIsReferenced = false

	// remove dead code (so we don't waste chracters quine cheating strings
	// that aren't even used)
	code = (await terser.minify(code, {
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

		const file = await parse(code)

		traverse(file, {
			MemberExpression({ node: memberExpression }) {
				if (memberExpression.computed)
					return

				assert(memberExpression.property.type == "Identifier")

				if (memberExpression.property.name == "prototype") {
					memberExpression.computed = true
					memberExpression.property = t.identifier(`_PROTOTYPE_PROPERTY_${uniqueID}_`)
				} else if (memberExpression.property.name == "__proto__") {
					memberExpression.computed = true
					memberExpression.property = t.identifier(`_PROTO_PROPERTY_${uniqueID}_`)
				}
			}
		})

		scriptBeforeJSONValueReplacement = (await terser.minify(generate(file!).code, {
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
			.replace(new RegExp(`_PROTOTYPE_PROPERTY_${uniqueID}_`, "g"), `"prototype"`)
			.replace(new RegExp(`_PROTO_PROPERTY_${uniqueID}_`, "g"), `"__proto__"`)
	}

	let comment: string | null = null
	let hasComment = false

	{
		const file = await parse(code)
		const promises: Promise<any>[] = []

		traverse(file, {
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
							path.replaceWith(t.identifier(`_JSON_VALUE_${jsonValues.push(o) - 1}_${uniqueID}_`))
					},

					ArrayExpression(path) {
						const o: unknown[] = []

						if (parseArrayExpression(path.node, o))
							path.replaceWith(t.identifier(`_JSON_VALUE_${jsonValues.push(o) - 1}_${uniqueID}_`))
					}
				})

				path.traverse({
					TemplateLiteral(path) {
						const templateLiteral = path.node
						let replacement: babel.Node = t.stringLiteral(templateLiteral.quasis[0].value.cooked!)

						for (let i = 0; i < templateLiteral.expressions.length; i++) {
							const expression = templateLiteral.expressions[i] as Expression
							const templateElement = templateLiteral.quasis[i + 1]

							replacement = t.binaryExpression(
								"+",
								replacement,
								expression
							)

							if (!templateElement.value.cooked)
								continue

							replacement = t.binaryExpression(
								"+",
								replacement,
								t.stringLiteral(templateElement.value.cooked!)
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
						memberExpression.property = t.stringLiteral(memberExpression.property.name)
					},

					UnaryExpression(path) {
						if (path.node.operator == "void" && path.node.argument.type == "NumericLiteral" && !path.node.argument.value) {
							path.replaceWith(t.identifier(`_UNDEFINED_${uniqueID}_`))
							undefinedIsReferenced = true
						}
					},

					NullLiteral(path) {
						let jsonValueIndex = jsonValues.indexOf(null)

						if (jsonValueIndex == -1)
							jsonValueIndex += jsonValues.push(null)

						path.replaceWith(t.identifier(`_JSON_VALUE_${jsonValueIndex}_${uniqueID}_`))
					},

					BooleanLiteral(path) {
						let jsonValueIndex = jsonValues.indexOf(path.node.value)

						if (jsonValueIndex == -1)
							jsonValueIndex += jsonValues.push(path.node.value)

						path.replaceWith(t.identifier(`_JSON_VALUE_${jsonValueIndex}_${uniqueID}_`))
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

							path.replaceWith(t.identifier(`_JSON_VALUE_${jsonValueIndex}_${uniqueID}_`))
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

						path.replaceWith(t.identifier(`_JSON_VALUE_${jsonValueIndex}_${uniqueID}_`))
					},

					ObjectProperty({ node }) {
						if (node.computed || node.key.type != "Identifier" || node.key.name.length < 4)
							return

						let jsonValueIndex = jsonValues.indexOf(node.key.name)

						if (jsonValueIndex == -1)
							jsonValueIndex += jsonValues.push(node.key.name)

						node.computed = true
						node.key = t.identifier(`_JSON_VALUE_${jsonValueIndex}_${uniqueID}_`)
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
					const variableDeclaration = t.variableDeclaration(
						"let",
						[
							t.variableDeclarator(
								t.identifier(`_JSON_VALUE_0_${uniqueID}_`),
								t.memberExpression(
									t.taggedTemplateExpression(
										t.memberExpression(
											t.callExpression(t.identifier(`$${uniqueID}$SUBSCRIPT$scripts$quine`), []),
											t.identifier("split")
										),
										t.templateLiteral([ t.templateElement({ raw: "\t", cooked: "\t" }, true) ], [])
									),
									t.identifier(`$${uniqueID}$SPLIT_INDEX`),
									true
								)
							)
						]
					)

					if (undefinedIsReferenced)
						variableDeclaration.declarations.push(t.variableDeclarator(t.identifier(`_UNDEFINED_${uniqueID}_`)))

					functionDeclaration.body.body.unshift(variableDeclaration)

					comment = jsonValues[0]
				} else {
					const variableDeclaration = t.variableDeclaration(
						"let",
						[
							t.variableDeclarator(
								t.identifier(`_JSON_VALUE_0_${uniqueID}_`),
								t.callExpression(
									t.memberExpression(
										t.identifier("JSON"),
										t.identifier("parse")
									),
									[
										t.memberExpression(
											t.taggedTemplateExpression(
												t.memberExpression(
													t.callExpression(t.identifier(`$${uniqueID}$SUBSCRIPT$scripts$quine`), []),
													t.identifier("split")
												),
												t.templateLiteral([ t.templateElement({ raw: "\t", cooked: "\t" }, true) ], [])
											),
											t.identifier(`$${uniqueID}$SPLIT_INDEX`),
											true
										)
									]
								)
							)
						]
					)

					if (undefinedIsReferenced)
						variableDeclaration.declarations.push(t.variableDeclarator(t.identifier(`_UNDEFINED_${uniqueID}_`)))

					functionDeclaration.body.body.unshift(variableDeclaration)

					comment = JSON.stringify(jsonValues[0])
				}
			} else {
				const variableDeclaration = t.variableDeclaration(
					"let",
					[
						t.variableDeclarator(
							t.arrayPattern(jsonValues.map((_, i) => t.identifier(`_JSON_VALUE_${i}_${uniqueID}_`))),
							t.callExpression(
								t.memberExpression(
									t.identifier("JSON"),
									t.identifier("parse")
								),
								[
									t.memberExpression(
										t.taggedTemplateExpression(
											t.memberExpression(
												t.callExpression(t.identifier(`$${uniqueID}$SUBSCRIPT$scripts$quine`), []),
												t.identifier("split")
											),
											t.templateLiteral([ t.templateElement({ raw: "\t", cooked: "\t" }, true) ], [])
										),
										t.identifier(`$${uniqueID}$SPLIT_INDEX`),
										true
									)
								]
							)
						)
					]
				)

				if (undefinedIsReferenced)
					variableDeclaration.declarations.push(t.variableDeclarator(t.identifier(`_UNDEFINED_${uniqueID}_`)))

				functionDeclaration.body.body.unshift(variableDeclaration)

				comment = JSON.stringify(jsonValues)
			}
		} else if (undefinedIsReferenced) {
			functionDeclaration.body.body.unshift(
				t.variableDeclaration(
					"let",
					[ t.variableDeclarator(t.identifier(`_UNDEFINED_${uniqueID}_`)) ]
				)
			)
		}

		code = generate(file!).code
	}

	code = (await terser.minify(code, {
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


	// this step affects the character count and can't be done after the count comparison
	if (comment != null) {
		code = spliceString(code, `${autocomplete ? `//${autocomplete}\n` : ""}\n//\t${comment}\t\n`, getFunctionBodyStart(code) + 1)

		for (const [ i, part ] of code.split("\t").entries()) {
			if (part == comment) {
				code = code.replace(`$${uniqueID}$SPLIT_INDEX`, await minifyNumber(i))
				break
			}
		}
	}

	// if the script has a comment, it's gonna contain `SC$scripts$quine()`
	// which is gonna eventually compile to `#fs.scripts.quine()` which contains
	// an extra character so we have to account for that
	if (getHackmudCharacterCount(scriptBeforeJSONValueReplacement) <= (getHackmudCharacterCount(code) + Number(hasComment))) {
		code = scriptBeforeJSONValueReplacement

		if (autocomplete)
			code = spliceString(code, `//${autocomplete}\n`, getFunctionBodyStart(code) + 1)
	}

	return code
}

export default minify

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
			else
				return false
		} else if (property.value.type == "ObjectExpression") {
			const childObject: Record<string, unknown> = {}

			if (parseObjectExpression(property.value, childObject))
				o[property.key.type == "Identifier" ? property.key.name : property.key.value] = childObject
			else
				return false
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

async function minifyNumber(number: number) {
	return (await terser.minify(`$(${number})`, { ecma: 2015 })).code!.match(/\$\((.+)\)/)![1]
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
