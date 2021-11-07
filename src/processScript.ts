import { Token, tokenizer as tokenize, tokTypes as tokenTypes } from "acorn"
import { generate as generateCodeFromAST } from "escodegen"
import { parseScript } from "esprima"
import query from "esquery"
import ASTNodes from "estree"
import { minify } from "terser"
import typescript from "typescript"
import { clearObject, hackmudLength, positionToLineNumber, stringSplice } from "./lib"

/**
 * Minifies a given script
 *
 * @param script JavaScript or TypeScript code
 */
export async function processScript(script: string) {
	let preScriptComments: string | undefined
	let autocomplete: string | undefined

	[ , preScriptComments, script, autocomplete ] = script.match(/((?:^\s*\/\/.*\n)*)\s*((?:.+?\/\/\s*(.+?)\s*$)?[^]*)/m)!

	if (!script)
		throw new Error("script was empty")

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

	// typescript compilation, this runs on regular javascript too to convert
	// any post es2015 syntax into es2015 syntax
	const { outputText, diagnostics = [] } = typescript.transpileModule(script, {
		compilerOptions: { target: typescript.ScriptTarget.ES2015 },
		reportDiagnostics: true
	})

	const warnings = diagnostics.map(({ messageText, start }) => ({
		message: typeof messageText == "string" ? messageText : messageText.messageText,
		line: positionToLineNumber(start!, script)
	}))

	script = outputText.replace(/^export /, "")

	const ast = parseScript(script)
	const randomString = (Math.random() * (2 ** 53)).toString(36)

	for (const node of query(ast, "ClassBody > MethodDefinition[kind=constructor] > FunctionExpression > BlockStatement") as ASTNodes.BlockStatement[]) {
		node.body.unshift({
			type: "VariableDeclaration",
			declarations: [ {
				type: "VariableDeclarator",
				id: {
					type: "Identifier",
					name: `_THIS_${randomString}_`
				}
			} ],
			kind: "let"
		})
	}

	for (const node of query(ast, "ClassBody > MethodDefinition[kind=constructor] > FunctionExpression > BlockStatement !CallExpression > Super") as ASTNodes.CallExpression[]) {
		const newNode: ASTNodes.AssignmentExpression = {
			type: "AssignmentExpression",
			operator: "=",
			left: {
				type: "Identifier",
				name: `_THIS_${randomString}_`
			},
			right: { ...node }
		}

		Object.assign(clearObject(node), newNode)
	}

	for (const node of query(ast, "ClassBody > MethodDefinition > FunctionExpression > BlockStatement !ThisExpression") as ASTNodes.ThisExpression[]) {
		const newNode: ASTNodes.Identifier = {
			type: "Identifier",
			name: `_THIS_${randomString}_`
		}

		Object.assign(clearObject(node), newNode)
	}

	for (const node of query(ast, "ClassBody > MethodDefinition[kind=method] > FunctionExpression > BlockStatement") as ASTNodes.BlockStatement[]) {
		node.body.unshift({
			type: "VariableDeclaration",
			declarations: [ {
				type: "VariableDeclarator",
				id: {
					type: "Identifier",
					name: `_THIS_${randomString}_`
				},
				init: {
					type: "CallExpression",
					callee: {
						type: "MemberExpression",
						computed: false,
						object: { type: "Super" },
						property: {
							type: "Identifier",
							name: "valueOf"
						}
					},
					arguments: []
				}
			} ],
			kind: "let"
		})
	}

	script = generateCodeFromAST(ast)

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
			booleans: false
		}
	})).code || ""

	let blockStatementIndex: number

	if (script.startsWith("function "))
		blockStatementIndex = getFunctionBodyStart(script)
	else {
		script = `function script(context, args) {\n${script}\n}`
		blockStatementIndex = 31
		srcLength += 24
	}

	let scriptBeforeJSONValueReplacement = (await minify(script, {
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
			unsafe_undefined: true
		},
		format: { semicolons: false }
	})).code || ""

	{
		const tokens = [ ...tokenize(scriptBeforeJSONValueReplacement, { ecmaVersion: 2015 }) ].reverse().values()

		for (const token of tokens) {
			// we can't replace any tokens before the block statement or we'll break stuff
			if (token.start < blockStatementIndex)
				break

			switch (token.type) {
				case tokenTypes.name: {
					if (token.value != "prototype" && token.value != "__proto__")
						break

					const tokenBefore = tokens.next().value as Token

					if (tokenBefore.type != tokenTypes.dot)
						break

					srcLength += 3
					scriptBeforeJSONValueReplacement = stringSplice(scriptBeforeJSONValueReplacement, `["${token.value}"]`, tokenBefore.start, token.end)
				} break

				case tokenTypes._const: {
					scriptBeforeJSONValueReplacement = stringSplice(scriptBeforeJSONValueReplacement, "let", token.start, token.end)
				} break

				case tokenTypes._this:
					throw new Error('"this" keyword is not supported in hackmud')
			}
		}
	}

	const jsonValues: any[] = []
	let undefinedIsReferenced = false

	// we iterate through the tokens backwards so that substring replacements
	// don't affect future replacements since a part of the string could be
	// replaced with a string of a different length which messes up indexes
	const tokens = [ ...tokenize(script, { ecmaVersion: 2015 }) ].reverse().values()

	let templateToRightOfPlaceholder = false

	for (const token of tokens) {
		// we can't replace any tokens before the block statement or we'll break stuff
		if (token.start < blockStatementIndex)
			break

		switch (token.type) {
			case tokenTypes.backQuote: {
				const templateToken = tokens.next().value as Token

				if ((tokens.next().value as Token).type == tokenTypes.backQuote)
					throw new Error("tagged templates not supported yet")

				// no point in concatenating an empty string
				if (templateToken.value == "") {
					script = stringSplice(script, "))", templateToken.start - 1, token.end)
					break
				}

				let jsonValueIndex = jsonValues.indexOf(templateToken.value)

				if (jsonValueIndex == -1)
					jsonValueIndex += jsonValues.push(templateToken.value)

				script = stringSplice(script, `)+_JSON_VALUE_${jsonValueIndex}_${randomString}_)`, templateToken.start - 1, token.end)
			} break

			case tokenTypes.template: {
				if ((tokens.next().value as Token).type == tokenTypes.backQuote) {
					if ((tokens.next().value as Token).type == tokenTypes.name)
						throw new Error("tagged templates not supported yet")

					// there *is* a point in concatenating an empty string at the
					// start because foo + bar is not the same thing as "" + foo + bar
					// ...but foo + "<template>" + bar *is* the same thing as "" + foo + "<template>" + bar
					// so we just need to check if there's a template to the right of the placeholder and skip that case

					if (token.value == "" && templateToRightOfPlaceholder) {
						templateToRightOfPlaceholder = false
						script = stringSplice(script, "((", token.start - 1, token.end + 2)
						break
					}

					templateToRightOfPlaceholder = false

					let jsonValueIndex = jsonValues.indexOf(token.value)

					if (jsonValueIndex == -1)
						jsonValueIndex += jsonValues.push(token.value)

					script = stringSplice(script, `(_JSON_VALUE_${jsonValueIndex}_${randomString}_+(`, token.start - 1, token.end + 2)
					break
				}

				// no point in concatenating an empty string
				if (token.value == "") {
					templateToRightOfPlaceholder = false
					script = stringSplice(script, ")+(", token.start - 1, token.end + 2)
					break
				}

				templateToRightOfPlaceholder = true

				let jsonValueIndex = jsonValues.indexOf(token.value)

				if (jsonValueIndex == -1)
					jsonValueIndex += jsonValues.push(token.value)

				script = stringSplice(script, `)+_JSON_VALUE_${jsonValueIndex}_${randomString}_+(`, token.start - 1, token.end + 2)
			} break

			case tokenTypes.name: {
				if (token.value.length < 3)
					break

				const tokenBefore = tokens.next().value as Token

				if (tokenBefore.type == tokenTypes.dot) {
					let jsonValueIndex = jsonValues.indexOf(token.value)

					if (jsonValueIndex == -1)
						jsonValueIndex += jsonValues.push(token.value)

					script = stringSplice(script, `[_JSON_VALUE_${jsonValueIndex}_${randomString}_]`, tokenBefore.start, token.end)
					break
				}

				if (token.value == "undefined") {
					script = stringSplice(script, ` _UNDEFINED_${randomString}_ `, token.start, token.end)
					undefinedIsReferenced = true
				}
			} break

			case tokenTypes._null: {
				let jsonValueIndex = jsonValues.indexOf(null)

				if (jsonValueIndex == -1)
					jsonValueIndex += jsonValues.push(null)

				script = stringSplice(script, ` _JSON_VALUE_${jsonValueIndex}_${randomString}_ `, token.start, token.end)
			} break

			case tokenTypes._true: {
				let jsonValueIndex = jsonValues.indexOf(true)

				if (jsonValueIndex == -1)
					jsonValueIndex += jsonValues.push(true)

				script = stringSplice(script, ` _JSON_VALUE_${jsonValueIndex}_${randomString}_ `, token.start, token.end)
			} break

			case tokenTypes._false: {
				let jsonValueIndex = jsonValues.indexOf(false)

				if (jsonValueIndex == -1)
					jsonValueIndex += jsonValues.push(false)

				script = stringSplice(script, ` _JSON_VALUE_${jsonValueIndex}_${randomString}_ `, token.start, token.end)
			} break

			case tokenTypes.num: {
				if (token.value == 0) {
					const tokenBefore = tokens.next().value as Token

					if (tokenBefore.type == tokenTypes._void) {
						script = stringSplice(script, ` _UNDEFINED_${randomString}_ `, tokenBefore.start, token.end)
						undefinedIsReferenced = true
					}

					// may as well break here since we're gonna break anyway
					break
				}

				if (token.value < 10)
					break

				let jsonValueIndex = jsonValues.indexOf(token.value)

				if (jsonValueIndex == -1)
					jsonValueIndex += jsonValues.push(token.value)

				script = stringSplice(script, ` _JSON_VALUE_${jsonValueIndex}_${randomString}_ `, token.start, token.end)
			} break

			case tokenTypes.string: {
				if (token.value.includes("\u0000"))
					break

				// BUG in the code `({ "-": "bar" })` `"-"` is recognised as a string and is replaced with `_JSON_VALUE_n_` which is not equivalent code

				let jsonValueIndex = jsonValues.indexOf(token.value)

				if (jsonValueIndex == -1)
					jsonValueIndex += jsonValues.push(token.value)

				script = stringSplice(script, ` _JSON_VALUE_${jsonValueIndex}_${randomString}_ `, token.start, token.end)
			} break

			case tokenTypes._const: {
				script = stringSplice(script, "let", token.start, token.end)
			} break

			case tokenTypes._this:
				throw new Error('"this" keyword is not supported in hackmud')
		}
	}

	let comment: string | null = null
	let hasComment = false

	if (jsonValues.length) {
		hasComment = true

		if (jsonValues.length == 1) {
			if (typeof jsonValues[0] == "string" && !jsonValues[0].includes("\n") && !jsonValues[0].includes("\t")) {
				script = stringSplice(script, `\nlet _JSON_VALUE_0_${randomString}_ = SC$scripts$quine().split\`\t\`[_SPLIT_INDEX_${randomString}_]${undefinedIsReferenced ? `, _UNDEFINED_${randomString}_` : ""}\n`, blockStatementIndex + 1)
				comment = jsonValues[0]
			} else {
				script = stringSplice(script, `\nlet _JSON_VALUE_0_${randomString}_ = JSON.parse(SC$scripts$quine().split\`\t\`[_SPLIT_INDEX_${randomString}_])${undefinedIsReferenced ? `, _UNDEFINED_${randomString}_` : ""}\n`, blockStatementIndex + 1)
				comment = JSON.stringify(jsonValues[0])
			}
		} else {
			script = stringSplice(script, `\nlet [ ${jsonValues.map((_, i) => `_JSON_VALUE_${i}_${randomString}_`).join(", ")} ] = JSON.parse(SC$scripts$quine().split\`\t\`[_SPLIT_INDEX_${randomString}_])${undefinedIsReferenced ? `, _UNDEFINED_${randomString}_` : ""}\n`, blockStatementIndex + 1)
			comment = JSON.stringify(jsonValues)
		}
	} else
		script = script.replace(`_UNDEFINED_${randomString}_`, "void 0")

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
			unsafe_undefined: true
		},
		format: { semicolons: false }
	})).code || ""

	// this step affects the chracter count and can't be done after the count comparison
	if (comment != null) {
		script = stringSplice(script, `${autocomplete ? `//${autocomplete}\n` : ""}\n//\t${comment}\t\n`, getFunctionBodyStart(script) + 1)

		for (const [ i, part ] of script.split("\t").entries()) {
			if (part != comment)
				continue

			script = script.replace(`_SPLIT_INDEX_${randomString}_`, (await minify(`$(${i})`, { ecma: 2015 })).code!.match(/\$\((.+)\)/)![1])
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
		warnings
	}
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
