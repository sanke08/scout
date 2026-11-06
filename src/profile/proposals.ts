/**
 * Pending proposals: model-written wordings that wait for the user's approval.
 *
 * A proposal lives in its own file, apart from the profile, so a model's suggestion can never
 * change what a resume says. Only `approve` turns one into an alternate wording of a point, and
 * only the user calls `approve`.
 *
 * Example: `store.add({ target, text, keys, claimCheck: "passed" })` stores a proposal;
 * `store.approve(id, profileStore)` adds it to the target point and removes it from the list.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ScoutError, type Profile, type ProfileStore } from "../shared/index.js";
import {
  describeFirstIssue,
  readJsonFile,
  refuseNewerSchema,
  writeJsonAtomically,
} from "./json-file.js";
import { addVariant, type PointAddress } from "./points.js";

/** Names the point a proposed wording belongs to, by position. */
export const pointAddressSchema = z.object({
  section: z.enum(["experience", "projects"]),
  entryIndex: z.number().int().nonnegative(),
  pointIndex: z.number().int().nonnegative(),
});

/**
 * One model-written wording waiting for approval.
 * - `id`: unique, used to approve or reject it.
 * - `target`: the point that would get the new wording.
 * - `text`, `keys`: the wording and the job terms that trigger it, as a variant has them.
 * - `createdAt`: ISO date and time the proposal was added.
 * - `claimCheck`: the result of the claim check as plain text, e.g. "passed" or
 *   "unsupported claim: Kafka". Shown to the user next to the wording.
 */
export const proposalSchema = z.object({
  id: z.string().min(1),
  target: pointAddressSchema,
  text: z.string().min(1),
  keys: z.array(z.string()),
  createdAt: z.string(),
  claimCheck: z.string(),
});
export type Proposal = z.infer<typeof proposalSchema>;

/** The proposals file: a format version and the list. */
const proposalFileSchema = z.object({
  schemaVersion: z.literal(1),
  proposals: z.array(proposalSchema),
});
type ProposalFile = z.infer<typeof proposalFileSchema>;

/** What a caller supplies to add a proposal; the store adds `id` and `createdAt`. */
export type NewProposal = Omit<Proposal, "id" | "createdAt">;

/** The things a test can replace so ids and times are predictable. */
export interface ProposalStoreOptions {
  /** Returns the current time. Default: the real clock. */
  now?: () => Date;
  /** Returns a new unique id. Default: a random UUID. */
  newId?: () => string;
}

/** Keeps proposals waiting for approval. */
export interface ProposalStore {
  /** Validates and stores a new proposal; returns it with its id and creation time. */
  add(proposal: NewProposal): Proposal;
  /** All pending proposals, oldest first. An empty list when there are none. */
  list(): Proposal[];
  /**
   * Adds the proposal as an alternate wording of its target point, saves the profile (version
   * goes up by one) and removes the proposal. Returns the saved profile. If the target is gone or
   * the wording uses a term the point does not allow, it throws `invalid-input` and keeps the
   * proposal and the profile unchanged.
   */
  approve(id: string, profileStore: ProfileStore): Profile;
  /** Removes the proposal without touching the profile. Throws `not-found` for an unknown id. */
  reject(id: string): void;
}

/**
 * Reads the proposals file; a missing file means no proposals. Refuses a newer file format and
 * an invalid file without touching it.
 */
function readProposalFile(path: string): ProposalFile {
  const raw = readJsonFile(path, "the proposals file");
  if (raw === undefined) {
    return { schemaVersion: 1, proposals: [] };
  }
  refuseNewerSchema(raw, proposalFileSchema.shape.schemaVersion.value, "the proposals file", path);
  const result = proposalFileSchema.safeParse(raw);
  if (!result.success) {
    throw new ScoutError(
      "invalid-input",
      describeFirstIssue(result.error, `the proposals file at ${path}`),
    );
  }
  return result.data;
}

/** Finds a proposal by id or throws `not-found` with a sentence naming the id. */
function findProposal(file: ProposalFile, id: string): Proposal {
  const found = file.proposals.find((proposal) => proposal.id === id);
  if (found === undefined) {
    throw new ScoutError(
      "not-found",
      `No pending proposal has the id ${id}. It may already have been approved or rejected.`,
    );
  }
  return found;
}

/** The profile-point address stored in a proposal, as the helpers expect it. */
function toPointAddress(proposal: Proposal): PointAddress {
  return { ...proposal.target };
}

/**
 * Creates the store for one proposals file (it is created on the first `add`).
 *
 * Example: `createProposalStore("/data/proposals.json")`. In tests pass `options` to make ids
 * and times predictable.
 */
export function createProposalStore(
  path: string,
  options: ProposalStoreOptions = {},
): ProposalStore {
  const now = options.now ?? ((): Date => new Date());
  const newId = options.newId ?? ((): string => randomUUID());

  /** Writes the list back, keeping the file format version. */
  const writeProposals = (proposals: Proposal[]): void => {
    writeJsonAtomically(path, { schemaVersion: 1, proposals });
  };

  return {
    add(input: NewProposal): Proposal {
      const proposal = proposalSchema.safeParse({
        ...input,
        id: newId(),
        createdAt: now().toISOString(),
      });
      if (!proposal.success) {
        throw new ScoutError(
          "invalid-input",
          describeFirstIssue(proposal.error, "the proposal being added"),
        );
      }
      const file = readProposalFile(path);
      writeProposals([...file.proposals, proposal.data]);
      return proposal.data;
    },

    list(): Proposal[] {
      return readProposalFile(path).proposals;
    },

    approve(id: string, profileStore: ProfileStore): Profile {
      const file = readProposalFile(path);
      const proposal = findProposal(file, id);
      const profile = profileStore.load();
      const changed = addVariant(profile, toPointAddress(proposal), {
        text: proposal.text,
        keys: proposal.keys,
      });
      const saved = profileStore.save(changed);
      writeProposals(file.proposals.filter((other) => other.id !== id));
      return saved;
    },

    reject(id: string): void {
      const file = readProposalFile(path);
      findProposal(file, id);
      writeProposals(file.proposals.filter((other) => other.id !== id));
    },
  };
}
