// The staffing base (packages/staffing): trades and certificate types
// (catalogs), workers with their certificates, clients, projects and
// assignments. Every function guards itself (permission + module enabled) and
// audits its writes. Roles: compose staffing:viewer / staffing:planner / staffing:admin.
//
// Demo data (dev only, refuses with APP_ENV=production):
//   npx convex run staffing:_seedDemo            (skips if workers exist)
//   npx convex run staffing:_seedDemo '{"reset":true}'
import { defineStaffing } from "@digimuza/staffing"
import { system } from "./system"

export const {
  // catalog
  listTrades,
  createTrade,
  updateTrade,
  deleteTrade,
  listCertificateTypes,
  createCertificateType,
  updateCertificateType,
  deleteCertificateType,
  // workers and certificates
  listWorkers,
  getWorker,
  findAvailableWorkers,
  createWorker,
  updateWorker,
  deleteWorker,
  generateCertificateUploadUrl,
  getCertificateFileUrl,
  addWorkerCertificate,
  updateWorkerCertificate,
  deleteWorkerCertificate,
  // clients
  listClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
  // projects and assignments
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  listAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  // dev only
  _seedDemo,
} = defineStaffing(system)
