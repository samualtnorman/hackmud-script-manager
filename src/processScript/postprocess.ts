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
		.replace(new RegExp(`\\$${uniqueID}\\$NOT_A_SUBSCRIPT\\$(#[\\w\\.]+)\\(\\$`, `g`), `$1\\(`)
		.replace(new RegExp(`\\$${uniqueID}\\$NOT_A_DB_CALL\\$(\\w+)\\$`, `g`), `#db.$1\\(`)
		.replace(new RegExp(`\\$${uniqueID}\\$NOT_A_DEBUG_CALL\\$`, `g`), `#D\\(`)
		.replace(new RegExp(`\\$${uniqueID}\\$NOT_FMCL\\$`, `g`), `#FMC\\L`)
		.replace(new RegExp(`\\$${uniqueID}\\$NOT_G\\$`, `g`), `#\\G`)
}

export default postprocess
