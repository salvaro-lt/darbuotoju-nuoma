// Staffing area "compliance" (packages/staffing/src/compliance, module
// `staffing-compliance`): document requirements per country and client,
// project readiness, expiry radar + daily digest (n8n webhook
// `dr-nuoma-dokumentu-galiojimas`), contract templates and contracts, the
// client document package. Roles: compose staffing-compliance:viewer / :planner / :admin.
//
// Demo data (dev only, after staffing:_seedDemo; refuses with APP_ENV=production):
//   npx convex run compliance:_seedDemo            (skips if templates exist)
//   npx convex run compliance:_seedDemo '{"reset":true}'
import { defineCompliance } from "@digimuza/staffing"
import { brand } from "../brand"
import { system } from "./system"

export const {
  // requirements and readiness
  listRequirements,
  addRequirement,
  deleteRequirement,
  listReadiness,
  getProjectReadiness,
  getProjectPackage,
  // expiry radar and digest
  listExpiring,
  listDigestRuns,
  sendDigest,
  _dailyDigest,
  _deliverDigest,
  _digestRun,
  _finishDigest,
  // templates and contracts
  listTemplates,
  saveTemplate,
  deleteTemplate,
  listContractCandidates,
  previewContract,
  generateContract,
  listContracts,
  getContract,
  deleteContract,
  // dev only
  _seedDemo,
  _seedFileTargets,
  _seedFiles,
  _attachSeedFile,
} = defineCompliance(system, { companyName: `UAB „${brand.name}“` })
