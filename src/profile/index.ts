/**
 * Public surface of the profile module. Other modules import only from here or `src/shared`.
 */
export { createProfileStore } from "./profile-store.js";
export {
  addPoint,
  addVariant,
  removePoint,
  removeVariant,
  setPointStatus,
  termsOfProfile,
  updatePoint,
  usablePoints,
  variantUsesOnlyAllowedTerms,
  type EntryAddress,
  type EntrySection,
  type PointAddress,
} from "./points.js";
export {
  createProposalStore,
  proposalSchema,
  type NewProposal,
  type Proposal,
  type ProposalStore,
  type ProposalStoreOptions,
} from "./proposals.js";
export {
  draftPointsFromNote,
  loadProjectNotes,
  parseProjectNote,
  type ProjectNote,
} from "./project-notes.js";
export { missingRequiredFields, type MissingField } from "./first-run.js";
