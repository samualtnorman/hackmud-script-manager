import { findMatches, spliceString } from "@samual/lib"

export function postprocess(code: string, seclevel: number, uniqueID: string) {
	code = code.replace(/^function\s*\w+\(/, "function(")

	for (const { index, match } of [ ...findMatches(new RegExp(`\\$${uniqueID}\\$[\\w$]+`, "g"), code) ].reverse()) {
		const [ type, ...args ] = match.slice(13).split("$")

		switch (type) {
			case "SUBSCRIPT": {
				code = spliceString(code, `#${"nlmhf"[seclevel]}s.${args[0]}.${args[1]}`, index, index + match.length)
			} break

			case "DEBUG": {
				code = spliceString(code, `#D`, index, index + match.length)
			} break

			case "FMCL": {
				code = spliceString(code, `#FMCL`, index, index + match.length)
			} break

			case "GLOBAL": {
				code = spliceString(code, `#GLOBAL`, index, index + match.length)
			} break

			case "DB": {
				code = spliceString(code, `#db.${args[0]}`, index, index + match.length)
			} break

			default:
				throw new Error(`unknown preprocessor directive type "${type}"`)
		}
	}

	return code
}

export default postprocess
