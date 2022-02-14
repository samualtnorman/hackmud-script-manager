import { findMatches, spliceString } from "@samual/lib"

export function postprocess(code: string, seclevel: number, uniqueID: string) {
	code = code
		.replace(/^function\s*\w+\(/, `function(`)
		.replace(new RegExp(`\\$${uniqueID}\\$\\\\\\\\0\\$SC_DOLLAR\\$`, `g`), `SC\\$`)
		.replace(new RegExp(`\\$${uniqueID}\\$\\\\\\\\0\\$DB_DOLLAR\\$`, `g`), `DB\\$`)
		.replace(new RegExp(`\\$${uniqueID}\\$\\\\\\\\0\\$D\\$`, `g`), `__D_\\S`)
		.replace(new RegExp(`\\$${uniqueID}\\$\\\\\\\\0\\$FMCL\\$`, `g`), `__FMCL\\_`)
		.replace(new RegExp(`\\$${uniqueID}\\$\\\\\\\\0\\$G\\$`, `g`), `__G\\_`)

	for (const { index, match } of [ ...findMatches(new RegExp(`\\$${uniqueID}\\$[\\w$]+`, `g`), code) ].reverse()) {
		const [ type, ...arguments_ ] = match.slice(13).split(`$`)

		switch (type) {
			case `SUBSCRIPT`: {
				code = spliceString(code, `#${`nlmhf`[seclevel]}s.${arguments_[0]}.${arguments_[1]}`, index, match.length)
			} break

			case `DEBUG`: {
				code = spliceString(code, `#D`, index, match.length)
			} break

			case `FMCL`: {
				code = spliceString(code, `#FMCL`, index, match.length)
			} break

			case `GLOBAL`: {
				code = spliceString(code, `#G`, index, match.length)
			} break

			case `DB`: {
				code = spliceString(code, `#db.${arguments_[0]}`, index, match.length)
			} break

			default:
				throw new Error(`unknown type "${type}"`)
		}
	}

	return code
}

export default postprocess
