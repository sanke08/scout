/**
 * The rules that decide which repository files are skipped, which count as configuration and
 * which source files are most informative.
 *
 * Why: the reader must be bounded and must not touch secrets or generated output. Keeping the
 * rules in one file makes "what does Scout read?" answerable by reading one page.
 */
import { basename, extname } from "node:path";

/** Folders that hold dependencies, version control data or build output; never entered. */
export const IGNORED_FOLDERS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "coverage",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
  ".turbo",
  ".idea",
  ".vscode",
]);

/** File extensions that are binary or media; never read. */
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".svgz",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".jar",
  ".war",
  ".class",
  ".o",
  ".a",
  ".so",
  ".dylib",
  ".dll",
  ".exe",
  ".bin",
  ".wasm",
  ".pyc",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".sqlite",
  ".db",
]);

/** Generated dependency lists: long, unreadable to a person, and not informative. */
const LOCKFILE_NAMES: ReadonlySet<string> = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "go.sum",
  "cargo.lock",
  "poetry.lock",
  "gemfile.lock",
  "composer.lock",
]);

/** File extensions of source code that can explain what a project does. */
const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".go",
  ".py",
  ".rs",
  ".java",
  ".kt",
  ".rb",
  ".php",
  ".cs",
  ".swift",
  ".c",
  ".h",
  ".cpp",
  ".sql",
  ".sh",
  ".prisma",
  ".proto",
  ".graphql",
]);

/** File names (lower-cased) that are configuration at any depth. */
const CONFIG_NAMES: ReadonlySet<string> = new Set([
  "package.json",
  "go.mod",
  "cargo.toml",
  "pyproject.toml",
  "requirements.txt",
  "gemfile",
  "pom.xml",
  "build.gradle",
  "tsconfig.json",
  "makefile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
]);

/** Words in a file name that make it more informative as a starting point. */
const INFORMATIVE_NAME =
  /^(index|main|app|server|cli|router|routes|handler|schema|model|service)\b/;

/** Folders whose files are the heart of a project. */
const CORE_FOLDERS = ["src/", "lib/", "cmd/", "internal/", "app/", "pkg/"];

/**
 * True when the file probably holds secrets and must never be read.
 * Example: `.env` and `server.pem` are secret-like; `.env.example` is not.
 */
export function isSecretLike(path: string): boolean {
  const name = basename(path).toLowerCase();
  if (name === ".env.example" || name === ".env.sample") {
    return false;
  }
  if (name === ".env" || name.startsWith(".env.")) {
    return true;
  }
  if ([".pem", ".key", ".p12", ".pfx"].includes(extname(name))) {
    return true;
  }
  return (
    name.startsWith("id_rsa") ||
    name.startsWith("id_ed25519") ||
    name === "credentials.json" ||
    name.startsWith("secrets.")
  );
}

/** True when the file is a generated dependency list. */
export function isLockfile(path: string): boolean {
  return LOCKFILE_NAMES.has(basename(path).toLowerCase());
}

/** True when the extension says the file is binary or media. */
export function hasBinaryExtension(path: string): boolean {
  return BINARY_EXTENSIONS.has(extname(path).toLowerCase());
}

/** True when the file is a README at the top level of the repository (`README`, `readme.md`...). */
export function isTopLevelReadme(path: string): boolean {
  return !path.includes("/") && basename(path).toLowerCase().startsWith("readme");
}

/**
 * True when the file is configuration worth reading: manifests, Dockerfiles, compose files and
 * continuous-integration workflows.
 * Example: `package.json`, `Dockerfile.prod`, `.github/workflows/ci.yml`.
 */
export function isConfigFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  if (CONFIG_NAMES.has(name) || name === "dockerfile" || name.startsWith("dockerfile.")) {
    return true;
  }
  const inWorkflows = path.startsWith(".github/workflows/");
  return inWorkflows && (name.endsWith(".yml") || name.endsWith(".yaml"));
}

/** True when the extension is source code worth reading. */
export function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(path).toLowerCase());
}

/** True when the file looks like a test (`x.test.ts`, `x_test.go`, `x.spec.js`). */
function looksLikeTest(path: string): boolean {
  return /(\.test\.|\.spec\.|_test\.)/.test(path.toLowerCase());
}

/**
 * How informative a source file is as a first read; higher is read first. Shallow files, files
 * with names like `index` or `server`, and files under `src/` score higher; tests score lower
 * because they describe behaviour but not structure.
 *
 * Example: `src/index.ts` scores higher than `src/deep/inner/helpers/format.ts`.
 */
export function sourceScore(path: string): number {
  const depth = path.split("/").length - 1;
  let score = 10 - depth * 2;
  if (INFORMATIVE_NAME.test(basename(path).toLowerCase())) {
    score += 5;
  }
  if (CORE_FOLDERS.some((folder) => path.startsWith(folder))) {
    score += 2;
  }
  if (looksLikeTest(path)) {
    score -= 4;
  }
  return score;
}
