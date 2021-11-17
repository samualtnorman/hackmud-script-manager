import { findMatches, stringSplice } from "../lib"

export function postProcess(code: string, seclevel: number, uniqueID: string) {
	code = code.replace(/^function\s*\w+\(/, "function(")

	for (const { index, match } of [ ...findMatches(new RegExp(`\\$${uniqueID}\\$[\\w$]+`, "g"), code) ].reverse()) {
		const [ type, ...args ] = match.slice(13).split("$")

		switch (type) {
			case "SUBSCRIPT": {
				code = stringSplice(code, `#${"nlmhf"[seclevel]}s.${args[0]}.${args[1]}`, index, index + match.length)
			} break

			case "DEBUG": {
				code = stringSplice(code, `#D`, index, index + match.length)
			} break

			case "FMCL": {
				code = stringSplice(code, `#FMCL`, index, index + match.length)
			} break

			case "GLOBAL": {
				code = stringSplice(code, `#GLOBAL`, index, index + match.length)
			} break

			case "DB": {
				code = stringSplice(code, `#db.${args[0]}`, index, index + match.length)
			} break

			default:
				throw new Error(`unknown preprocessor directive type "${type}"`)
		}
	}

	return code
}

export default postProcess
