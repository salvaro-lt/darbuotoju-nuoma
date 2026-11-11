#!/usr/bin/env node
// Switches where @digimuza/system-core comes from.
//
//   pnpm core:vendor        pack ../system-core (or $SYSTEM_CORE_DIR) into vendor/ and use the tarball.
//                           Default until 0.1.0 is on npm: works in CI and Docker with no access to the source repo.
//   pnpm core:link          link:../system-core, for editing core and app together. Local only.
//   pnpm core:npm [version] the published package. Default: the version behind the npm `latest`
//                           dist-tag (built from system-core's `production` branch), pinned exactly.
//                           Never `next` (X.Y.Z-rc.N from its release branches) in a client app.
//
// Each mode rewrites package.json and runs `pnpm install`. Commit package.json,
// pnpm-lock.yaml and vendor/ together.
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve, relative } from "node:path"

const PKG = "@digimuza/system-core"
const root = resolve(import.meta.dirname, "..")
const coreDir = resolve(root, process.env.SYSTEM_CORE_DIR ?? "../../../system-core")
const vendorDir = resolve(root, "vendor")
const [mode, requested] = process.argv.slice(2)

const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: "inherit" })

function setDependency(spec) {
  const path = resolve(root, "package.json")
  const pkg = JSON.parse(readFileSync(path, "utf8"))
  pkg.dependencies[PKG] = spec
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`${PKG} -> ${spec}`)
}

function requireCore() {
  if (!existsSync(resolve(coreDir, "package.json"))) {
    console.error(`system-core source not found at ${coreDir}. Set SYSTEM_CORE_DIR.`)
    process.exit(1)
  }
}

switch (mode) {
  case "vendor": {
    requireCore()
    run("npm", ["run", "build"], coreDir)
    rmSync(vendorDir, { recursive: true, force: true })
    mkdirSync(vendorDir)
    run("npm", ["pack", "--pack-destination", vendorDir], coreDir)
    const tgz = readdirSync(vendorDir).find((f) => f.endsWith(".tgz"))
    if (!tgz) throw new Error("npm pack produced no tarball")
    setDependency(`file:vendor/${tgz}`)
    break
  }
  case "link":
    requireCore()
    setDependency(`link:${relative(root, coreDir)}`)
    console.warn("link: mode is for local development. CI and the Docker build need `pnpm core:vendor` or `pnpm core:npm`.")
    break
  case "npm": {
    const version = requested ?? execFileSync("npm", ["view", `${PKG}@latest`, "version"], { encoding: "utf8" }).trim()
    if (/-/.test(version) && !requested) throw new Error(`npm latest is a prerelease (${version}); refusing`)
    setDependency(version)
    rmSync(vendorDir, { recursive: true, force: true })
    break
  }
  default:
    console.error("usage: core-source.mjs vendor | link | npm [range]")
    process.exit(1)
}

run("pnpm", ["install"])
