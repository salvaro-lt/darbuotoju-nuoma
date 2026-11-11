// Staffing area "compliance" (module `staffing-compliance`): document
// requirements, project readiness, expiry radar and digest, contract
// templates and contracts, the client document package.
// Pure helpers: `@digimuza/staffing/compliance/pure` (browser-safe).
// Named exports only, so other areas' names never collide with these.
export { staffingCompliance, StaffingCompliancePermissions, STAFFING_COMPLIANCE_MODULE_ID } from "./manifest"
export { complianceTables, type ComplianceTableName } from "./tables"
export { projectReadiness, expiringWithProjects, draftContract, type ProjectReadiness, type ReadinessRow, type ReadinessDocument, type ReadinessCellView, type ExpiringItem } from "./operations"
export {
  defineCompliance,
  type ComplianceFunctions,
  type ComplianceOptions,
  type ReadinessProjectSummary,
  type ProjectPackage,
  type PackageFile,
  type RequirementView,
  type TemplateView as ComplianceTemplateView,
  type ContractView as ComplianceContractView,
  type DigestRunView,
} from "./functions"
export { complianceTools, complianceProjectReadinessTool } from "./ai-tools"
// Client document package (DIG-113).
export {
  definePackageFunctions,
  cleanRecipients,
  PACKAGE_WEBHOOK,
  type PackagePreview,
  type PackageComposer,
  type PackageLogView,
  type PackageGapView,
  type WorkerPackageSend,
  type SharedPackage,
} from "./package-functions"
export { buildPackageDraft, insertPackage, issuePackageLink, type PackageDraft, type PackageCandidate, type PackageMember, type PackageRecipient, type PackageId } from "./package-operations"
export { complianceSendPackageTool } from "./ai-tools"
