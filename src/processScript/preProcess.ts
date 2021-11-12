export function preProcess(code: string) {
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
		throw new Error(`detected seclevel ${seclevelNames[detectedSeclevel]} is lower than stated seclevel ${seclevelNames[seclevel]}`)

	const semicolons = code.match(/;/g)?.length ?? 0

	code = code
		.replace(/#[fhmln43210]s\.scripts\.quine\(\)/g, JSON.stringify(code))
		.replace(/[#$][fhmln43210]?s\.([a-z_][a-z_0-9]{0,24})\.([a-z_][a-z_0-9]{0,24})\(/g, "SC$$$1$$$2(")
		.replace(/^function\s*\(/, "function script(")
		.replace(/#D\(/g, "$D(")
		.replace(/#FMCL/g, "$FMCL")
		.replace(/#G/g, "$G")
		.replace(/[#$]db\./g, "DB$")

	return {
		semicolons,
		autocomplete,
		seclevel,
		code
	}
}

export default preProcess
