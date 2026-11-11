#!/usr/bin/env node
// Cuts a release branch: `pnpm release:cut 1.2.0`
//
//   1. requires a clean tree on an up-to-date `main`
//   2. creates `release/1.2.0`, sets package.json "version" to 1.2.0, commits
//   3. prints the push command. Pushing starts the staging deploy, so it is left to you.
//
// Hotfix: `pnpm release:cut 1.2.1 --hotfix` branches `hotfix/1.2.1` from `production`.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

const [version, flag] = process.argv.slice(2)
const hotfix = flag === "--hotfix"
const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim()
const die = (m) => {
  console.error(`release:cut: ${m}`)
  process.exit(1)
}

if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) die("usage: pnpm release:cut X.Y.Z [--hotfix]")
if (git("status", "--porcelain")) die("working tree is not clean")
const from = hotfix ? "production" : "main"
const branch = `${hotfix ? "hotfix" : "release"}/${version}`

git("fetch", "origin", "--tags")
if (git("tag", "--list", `v${version}`)) die(`tag v${version} already exists`)
if (git("ls-remote", "--heads", "origin", branch)) die(`${branch} already exists on origin`)
git("switch", "--create", branch, `origin/${from}`)

const pkg = JSON.parse(readFileSync("package.json", "utf8"))
const previous = pkg.version
pkg.version = version
writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`)
git("commit", "--all", "--message", `chore(release): ${version}`)

console.log(`Created ${branch} from origin/${from} (version ${previous} -> ${version}).`)
console.log(`Push to deploy to staging:  git push -u origin ${branch}`)
console.log(`Linear milestone (optional): linear milestone create --project <app> --name v${version} -y`)
