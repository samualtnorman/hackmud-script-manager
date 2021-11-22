import babelGenerator from "@babel/generator"
import { parse } from "@babel/parser"
import babelTraverse, { NodePath } from "@babel/traverse"
import t, { Program } from "@babel/types"
import { assert, spliceString } from "@samual/lib"

const { default: traverse } = babelTraverse as any as typeof import("@babel/traverse")
const { default: generate } = babelGenerator as any as typeof import("@babel/generator")

export type PreprocessOptions = {
	/** 11 a-z 0-9 characters */
	uniqueID: string
}

/**
 * @param code source code to be preprocessed
 * @param options {@link PreprocessOptions details}
 */
export function preprocess(code: string, { uniqueID = "00000000000" }: Partial<PreprocessOptions> = {}) {
	assert(uniqueID.match(/^\w{11}$/))

	let preScriptComments: string | undefined
	let autocomplete: string | undefined

	[ , preScriptComments, code, autocomplete ] = code.match(/((?:^\s*\/\/.*\n)*)\s*((?:.+?\/\/\s*(.+?)\s*$)?[^]*)/m)!

	if (code.match(/(?:SC|DB)\$/))
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

	// TODO move this over to using the new system for finding subscripts

	let detectedSeclevel = 4

	if (code.match(/[#$][n0]s\.[a-z_][a-z_0-9]{0,24}\.[a-z_][a-z_0-9]{0,24}\(/))
		detectedSeclevel = 0
	else if (code.match(/[#$][l1]s\.[a-z_][a-z_0-9]{0,24}\.[a-z_][a-z_0-9]{0,24}\(/))
		detectedSeclevel = 1
	else if (code.match(/[#$][m2]s\.[a-z_][a-z_0-9]{0,24}\.[a-z_][a-z_0-9]{0,24}\(/))
		detectedSeclevel = 2
	else if (code.match(/[#$][h3]s\.[a-z_][a-z_0-9]{0,24}\.[a-z_][a-z_0-9]{0,24}\(/))
		detectedSeclevel = 3

	const seclevelNames = [ "NULLSEC", "LOWSEC", "MIDSEC", "HIGHSEC", "FULLSEC" ]

	if (seclevel == undefined)
		seclevel = detectedSeclevel
	else if (detectedSeclevel < seclevel)
		// TODO replace with a warning and build script anyway
		throw new Error(`detected seclevel ${seclevelNames[detectedSeclevel]} is lower than stated seclevel ${seclevelNames[seclevel]}`)

	const semicolons = code.match(/;/g)?.length ?? 0
	const sourceCode = code

	code = code.replace(/^function\s*\(/, "export default function (")

	// TODO I'm not actually doing anything with this yet
	let file

	while (true) {
		let error

		try {
			file = parse(code, {
				plugins: [
					"typescript",
					[ "decorators", { decoratorsBeforeExport: true } ],
					"doExpressions",
					"functionBind",
					"functionSent",
					"partialApplication",
					[ "pipelineOperator", { proposal: "hack", topicToken: "%" } ],
					"throwExpressions",
					[ "recordAndTuple", { syntaxType: "hash" } ],
					"classProperties",
					"classPrivateProperties",
					"classPrivateMethods",
					"logicalAssignment",
					"numericSeparator",
					"nullishCoalescingOperator",
					"optionalChaining",
					"optionalCatchBinding",
					"objectRestSpread"
				],
				sourceType: "module"
			})
			break
		} catch (error_) {
			assert(error_ instanceof SyntaxError)

			error = error_ as SyntaxError & {
				pos: number
				code: string
				reasonCode: String
			}
		}

		if (error.code != "BABEL_PARSER_SYNTAX_ERROR" || error.reasonCode != "PrivateInExpectedIn") {
			console.log(code.slice(error.pos).match(/.+/)?.[0])
			throw error
		}

		const codeSlice = code.slice(error.pos)

		let match

		// TODO detect typos and warn e.g. we throw on `#db.ObjectID(` and it makes it look like we don't support it
		if (match = codeSlice.match(/^#[fhmln43210]s\.scripts\.quine\(\)/))
			code = spliceString(code, JSON.stringify(sourceCode), error.pos, match[0].length)
		else if (match = codeSlice.match(/^#[fhmln43210]?s\.([a-z_][a-z_0-9]{0,24})\.([a-z_][a-z_0-9]{0,24})\(/))
			code = spliceString(code, `$${uniqueID}$SUBSCRIPT$${match[1]}$${match[2]}(`, error.pos, match[0].length)
		else if (match = codeSlice.match(/^#D\(/))
			code = spliceString(code, `$${uniqueID}$DEBUG(`, error.pos, match[0].length)
		else if (match = codeSlice.match(/^#FMCL/))
			code = spliceString(code, `$${uniqueID}$FMCL`, error.pos, match[0].length)
		else if (match = codeSlice.match(/^#G/))
			code = spliceString(code, `$${uniqueID}$GLOBAL`, error.pos, match[0].length)
		else if (match = codeSlice.match(/^#db\.(i|r|f|u|u1|us|ObjectId)\(/))
			code = spliceString(code, `$${uniqueID}$DB$${match[1]}(`, error.pos, match[0].length)
		else
			throw error
	}

	let program!: NodePath<Program>

	traverse(file, {
		Program(path) {
			program = path
			path.skip()
		}
	})

	const needRecord = program.scope.hasGlobal("Record")
	const needTuple = program.scope.hasGlobal("Tuple")

	if (needRecord || needTuple) {
		file.program.body.unshift(t.importDeclaration(
			needRecord
				? needTuple
					? [
						t.importSpecifier(t.identifier("Record"), t.identifier("Record")),
						t.importSpecifier(t.identifier("Tuple"), t.identifier("Tuple"))
					]
					: [ t.importSpecifier(t.identifier("Record"), t.identifier("Record")) ]
				: [ t.importSpecifier(t.identifier("Tuple"), t.identifier("Tuple")) ],
			t.stringLiteral("@bloomberg/record-tuple-polyfill")
		))
	}

	if (program.scope.hasGlobal("Proxy")) {
		file.program.body.unshift(t.importDeclaration([
			t.importDefaultSpecifier(t.identifier("Proxy"))
		], t.stringLiteral("proxy-polyfill/src/proxy.js")))
	}

	return {
		semicolons,
		autocomplete,
		seclevel,
		code: generate(file).code
	}
}

export default preprocess
