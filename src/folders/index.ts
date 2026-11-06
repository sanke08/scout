/**
 * Public surface of the folders module. Other modules import only from here.
 *
 * - Job folders: `createJobFolderManager` (find or create a folder, update `job.md`, save resumes).
 * - Board: `buildBoardTable`, `writeBoardTable`.
 * - Leads: `writeLeadsFile`, `latestLeadsFile`, `markLead`, `readLeadStatuses`.
 * - Backups: `createBackup`, `restoreBackup`.
 * - Health: `buildHealthReport`, `renderHealthText`, `isHeartbeatStale`.
 * - Background service: `renderLaunchAgentPlist` (text only).
 */
export { createJobFolderManager, JOB_FILE_NAME, SENT_FOLDER_NAME } from "./job-folder.js";
export type {
  EnsureJobFolderOptions,
  JobFolder,
  JobFolderManager,
  JobFolderManagerOptions,
  TailoredResume,
} from "./job-folder.js";
export { JOB_FIELD_KEYS, JOB_SECTION_TITLES } from "./job-document.js";
export type { JobFieldKey, JobSectionTitle } from "./job-document.js";
export { parseFrontMatter, UNKNOWN_VALUE } from "./front-matter.js";
export type { ParsedFrontMatter } from "./front-matter.js";
export { camelCaseCompany, makeFolderName, roleSlug } from "./naming.js";
export {
  BOARD_FILE_NAME,
  BOARD_STATUS_ORDER,
  buildBoardTable,
  writeBoardTable,
} from "./board-table.js";
export type { BoardRow, BoardTable, SkippedFolder } from "./board-table.js";
export { latestLeadsFile, markLead, readLeadStatuses, writeLeadsFile } from "./leads.js";
export type { LeadRow, LeadStatus, LeadStatusEntry, SavedLeadsFile } from "./leads.js";
export { BACKUP_MARKER_NAME, createBackup, restoreBackup } from "./backup.js";
export type { BackupResult, CreateBackupOptions, RestoreBackupOptions } from "./backup.js";
export {
  DEFAULT_HEARTBEAT_HOURS,
  buildHealthReport,
  isHeartbeatStale,
  renderHealthText,
} from "./health.js";
export type { HealthInputs, HealthReport, WaitingJob } from "./health.js";
export { renderLaunchAgentPlist } from "./launch-agent.js";
export type { LaunchAgentOptions } from "./launch-agent.js";
