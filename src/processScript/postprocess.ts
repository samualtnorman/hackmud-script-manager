export const postprocess = (code: string, seclevel: number, uniqueID: string) => {
	return code
		.replace(/^function\s*\w+\(/, `function(`)
		.replace(new RegExp(`\\$${uniqueID}\\$\\\\(?:\\\\)?\\$SC_DOLLAR\\$`, `g`), `S\\C$`)
		.replace(new RegExp(`\\$${uniqueID}\\$\\\\(?:\\\\)?\\$DB_DOLLAR\\$`, `g`), `D\\B$`)
		.replace(new RegExp(`\\$${uniqueID}\\$\\\\(?:\\\\)?\\$D\\$`, `g`), `_\\_D_S`)
		.replace(new RegExp(`\\$${uniqueID}\\$\\\\(?:\\\\)?\\$FMCL\\$`, `g`), `_\\_FMCL_`)
		.replace(new RegExp(`\\$${uniqueID}\\$\\\\(?:\\\\)?\\$G\\$`, `g`), `_\\_G_`)
		.replace(new RegExp(`\\$${uniqueID}\\$SUBSCRIPT\\$(\\w+)\\$(\\w+)\\$`, `g`), `#${`nlmhf`[seclevel]}s.$1.$2`)
		.replace(new RegExp(`\\$${uniqueID}\\$DEBUG\\$`, `g`), `#D`)
		.replace(new RegExp(`\\$${uniqueID}\\$FMCL\\$`, `g`), `#FMCL`)
		.replace(new RegExp(`\\$${uniqueID}\\$GLOBAL\\$`, `g`), `#G`)
		.replace(new RegExp(`\\$${uniqueID}\\$DB\\$(\\w+)\\$`, `g`), `#db.$1`)
		.replace(new RegExp(`\\$${uniqueID}\\$SLASH_SLASH\\$`, `g`), `/\\/`)
		.replace(new RegExp(`\\$${uniqueID}\\$NOT_A_SUBSCRIPT\\$(#[\\w\\.]+)\\(\\$`, `g`), `$1\\(`)
		.replace(new RegExp(`\\$${uniqueID}\\$NOT_A_DB_CALL\\$(\\w+)\\$`, `g`), `#db.$1\\(`)
		.replace(new RegExp(`\\$${uniqueID}\\$NOT_A_DEBUG_CALL\\$`, `g`), `#D\\(`)
		.replace(new RegExp(`\\$${uniqueID}\\$NOT_FMCL\\$`, `g`), `#\\FMCL`)
		.replace(new RegExp(`\\$${uniqueID}\\$NOT_G\\$`, `g`), `#\\G`)
}

export default postprocess
