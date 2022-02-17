export function postprocess(code: string, seclevel: number, uniqueID: string) {
	return code
		.replace(/^function\s*\w+\(/, `function(`)
		.replace(new RegExp(`\\$${uniqueID}\\$\\\\\\\\0\\$SC_DOLLAR\\$`, `g`), `SC\\$`)
		.replace(new RegExp(`\\$${uniqueID}\\$\\\\\\\\0\\$DB_DOLLAR\\$`, `g`), `DB\\$`)
		.replace(new RegExp(`\\$${uniqueID}\\$\\\\\\\\0\\$D\\$`, `g`), `__D_\\S`)
		.replace(new RegExp(`\\$${uniqueID}\\$\\\\\\\\0\\$FMCL\\$`, `g`), `__FMCL\\_`)
		.replace(new RegExp(`\\$${uniqueID}\\$\\\\\\\\0\\$G\\$`, `g`), `__G\\_`)
		.replace(new RegExp(`\\$${uniqueID}\\$SUBSCRIPT\\$(\\w+)\\$(\\w+)`, `g`), `#${`nlmhf`[seclevel]}s.$1.$2`)
		.replace(new RegExp(`\\$${uniqueID}\\$DEBUG`, `g`), `#D`)
		.replace(new RegExp(`\\$${uniqueID}\\$FMCL`, `g`), `#FMCL`)
		.replace(new RegExp(`\\$${uniqueID}\\$GLOBAL`, `g`), `#G`)
		.replace(new RegExp(`\\$${uniqueID}\\$DB\\$(\\w+)`, `g`), `#db.$1`)
		.replace(new RegExp(`\\$${uniqueID}\\$SLASH_SLASH\\$`, `g`), `/\\/`)
}

export default postprocess
