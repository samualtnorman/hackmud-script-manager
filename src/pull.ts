import { copyFilePersistent } from "@samual/lib/copyFilePersistent"
import { resolve as resolvePath } from "path"

/** Copies script from hackmud to local source folder.
  * @param sourceFolderPath path to folder containing source files
  * @param hackmudPath path to hackmud directory
  * @param script to pull in `user.name` format */
export async function pull(sourceFolderPath: string, hackmudPath: string, script: string): Promise<void> {
	const [ user, name ] = script.split(`.`)

	if (!user || !name)
		throw new Error(`\`script\` argument must be in "user.name" format`)

	await copyFilePersistent(
		resolvePath(hackmudPath, user, `scripts`, `${name}.js`),
		resolvePath(sourceFolderPath, user, `${name}.js`)
	)
}
