/**
 * A fixed list of well-known technology names, each with a plain-words family.
 *
 * Why: a job description is free text, so the interview plan needs a list of names to look for.
 * The family lets a gap be answered honestly with something the user really has in the same family
 * ("I have not used Kafka in production; I have used RabbitMQ, which does a similar job").
 * The list never adds anything to the profile; it only says what to look for in job text.
 */

/** One known technology: its usual spelling and the kind of job it does, in plain words. */
export interface KnownTechnology {
  term: string;
  family: string;
}

/**
 * The known technologies. Example entry: `{ term: "Kafka", family: "messaging and streaming" }`.
 * A technology missing here is still found when the posting lists it as a skill or the profile
 * holds it; it just has no family, so a gap in it gets the plain "not used it" answer.
 */
export const KNOWN_TECHNOLOGIES: readonly KnownTechnology[] = [
  // programming languages
  { term: "TypeScript", family: "programming languages" },
  { term: "JavaScript", family: "programming languages" },
  { term: "Python", family: "programming languages" },
  { term: "Go", family: "programming languages" },
  { term: "Java", family: "programming languages" },
  { term: "Kotlin", family: "programming languages" },
  { term: "Rust", family: "programming languages" },
  { term: "C#", family: "programming languages" },
  { term: "C++", family: "programming languages" },
  { term: "Ruby", family: "programming languages" },
  { term: "PHP", family: "programming languages" },
  { term: "Swift", family: "programming languages" },
  { term: "Scala", family: "programming languages" },
  { term: "Elixir", family: "programming languages" },
  // front-end frameworks
  { term: "React", family: "front-end frameworks" },
  { term: "Next.js", family: "front-end frameworks" },
  { term: "Vue", family: "front-end frameworks" },
  { term: "Angular", family: "front-end frameworks" },
  { term: "Svelte", family: "front-end frameworks" },
  { term: "Redux", family: "front-end frameworks" },
  { term: "Tailwind CSS", family: "front-end frameworks" },
  { term: "GraphQL", family: "front-end frameworks" },
  // back-end frameworks
  { term: "Node.js", family: "back-end frameworks" },
  { term: "Express", family: "back-end frameworks" },
  { term: "NestJS", family: "back-end frameworks" },
  { term: "Django", family: "back-end frameworks" },
  { term: "Flask", family: "back-end frameworks" },
  { term: "FastAPI", family: "back-end frameworks" },
  { term: "Spring Boot", family: "back-end frameworks" },
  { term: "Rails", family: "back-end frameworks" },
  { term: "Laravel", family: "back-end frameworks" },
  { term: ".NET", family: "back-end frameworks" },
  // relational databases
  { term: "PostgreSQL", family: "relational databases" },
  { term: "MySQL", family: "relational databases" },
  { term: "SQL", family: "relational databases" },
  { term: "SQLite", family: "relational databases" },
  { term: "Prisma", family: "relational databases" },
  // non-relational databases
  { term: "MongoDB", family: "non-relational databases" },
  { term: "DynamoDB", family: "non-relational databases" },
  { term: "Cassandra", family: "non-relational databases" },
  { term: "Elasticsearch", family: "non-relational databases" },
  // caching
  { term: "Redis", family: "caching" },
  { term: "Memcached", family: "caching" },
  // messaging and streaming
  { term: "Kafka", family: "messaging and streaming" },
  { term: "RabbitMQ", family: "messaging and streaming" },
  { term: "SQS", family: "messaging and streaming" },
  { term: "Pub/Sub", family: "messaging and streaming" },
  { term: "NATS", family: "messaging and streaming" },
  // cloud platforms
  { term: "AWS", family: "cloud platforms" },
  { term: "Azure", family: "cloud platforms" },
  { term: "GCP", family: "cloud platforms" },
  { term: "Google Cloud", family: "cloud platforms" },
  { term: "Lambda", family: "cloud platforms" },
  { term: "Cloudflare", family: "cloud platforms" },
  // containers and orchestration
  { term: "Docker", family: "containers and orchestration" },
  { term: "Kubernetes", family: "containers and orchestration" },
  { term: "Helm", family: "containers and orchestration" },
  { term: "Nomad", family: "containers and orchestration" },
  // infrastructure as code
  { term: "Terraform", family: "infrastructure as code" },
  { term: "Ansible", family: "infrastructure as code" },
  { term: "Pulumi", family: "infrastructure as code" },
  { term: "CloudFormation", family: "infrastructure as code" },
  // build and delivery
  { term: "GitHub Actions", family: "build and delivery" },
  { term: "Jenkins", family: "build and delivery" },
  { term: "GitLab CI", family: "build and delivery" },
  { term: "CircleCI", family: "build and delivery" },
  { term: "CI/CD", family: "build and delivery" },
  // testing
  { term: "Jest", family: "testing" },
  { term: "Vitest", family: "testing" },
  { term: "Cypress", family: "testing" },
  { term: "Playwright", family: "testing" },
  { term: "Pytest", family: "testing" },
  { term: "JUnit", family: "testing" },
  // monitoring
  { term: "Prometheus", family: "monitoring" },
  { term: "Grafana", family: "monitoring" },
  { term: "Datadog", family: "monitoring" },
  { term: "OpenTelemetry", family: "monitoring" },
  { term: "Sentry", family: "monitoring" },
  // API styles
  { term: "REST", family: "API styles" },
  { term: "gRPC", family: "API styles" },
  { term: "WebSockets", family: "API styles" },
  { term: "Webhooks", family: "API styles" },
  { term: "OAuth", family: "API styles" },
  // operating systems and tools
  { term: "Linux", family: "operating systems and tools" },
  { term: "Git", family: "operating systems and tools" },
  { term: "Bash", family: "operating systems and tools" },
];

/**
 * Finds the family of a term, ignoring capitalisation; `undefined` when the term is not in the
 * list. Example: `familyOf("kafka")` is "messaging and streaming".
 */
export function familyOf(term: string): string | undefined {
  const wanted = term.trim().toLowerCase();
  return KNOWN_TECHNOLOGIES.find((known) => known.term.toLowerCase() === wanted)?.family;
}
