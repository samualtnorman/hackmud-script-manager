import getPackageLatestVersion from "latest-version"
import fs from "fs"
import semver from "semver"

const { readFile } = fs.promises

const blacklist = new Set([
	`@types/node`
]);

(async () => {
	const packagesWithUpdateAvailable = []

	console.time(`time took`)

	const packageConfig = JSON.parse(await readFile(`package.json`, { encoding: `utf-8` }))

	await Promise.all([
		...Object.entries(packageConfig.dependencies || []),
		...Object.entries(packageConfig.devDependencies || []),
		...Object.entries(packageConfig.optionalDependencies || [])
	].map(async ([ name, currentVersion ]) => {
		if (blacklist.has(name))
			return

		const latestVersion = await getPackageLatestVersion(name)

		if (semver.gt(latestVersion, semver.coerce(currentVersion)) && !semver.satisfies(latestVersion, currentVersion)) {
			console.log(`${name}@${currentVersion} -> ${latestVersion}`)
			packagesWithUpdateAvailable.push(name)
		}
	}))

	if (packagesWithUpdateAvailable.length)
		console.log()

	console.timeEnd(`time took`)

	if (packagesWithUpdateAvailable.length)
		console.log(`\nyou should run this:\npnpm i ${packagesWithUpdateAvailable.map(name => `${name}@latest`).join(` `)}`)
})()
