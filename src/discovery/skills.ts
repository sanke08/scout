/**
 * The built-in vocabulary of technologies, and a function that finds the ones a posting names.
 *
 * Scout only records what the posting itself says. A skill is never added because it "would
 * fit"; the vocabulary only decides which written words count as a technology.
 */

/** One technology: the name Scout reports, and other ways it is commonly written. */
interface VocabularyEntry {
  /** The name reported, for example "Node.js". */
  name: string;
  /** Other spellings that mean the same thing, for example "NodeJS". */
  aliases?: string[];
  /** True when letter case matters, to avoid matching ordinary words. */
  caseSensitive?: boolean;
}

/**
 * The vocabulary. Single-letter or ordinary-word names ("C", "R", "Go") are left out on purpose
 * because they match plain English; "Golang" and "C++" are included.
 */
const VOCABULARY: VocabularyEntry[] = [
  { name: "JavaScript", aliases: ["Javascript"] },
  { name: "TypeScript", aliases: ["Typescript"] },
  { name: "Node.js", aliases: ["NodeJS", "Node js", "Node"], caseSensitive: true },
  { name: "Deno", caseSensitive: true },
  { name: "Bun", caseSensitive: true },
  { name: "React", aliases: ["ReactJS", "React.js"], caseSensitive: true },
  { name: "React Native", caseSensitive: true },
  { name: "Next.js", aliases: ["NextJS"] },
  { name: "Vue", aliases: ["Vue.js", "VueJS"], caseSensitive: true },
  { name: "Angular", caseSensitive: true },
  { name: "Svelte", caseSensitive: true },
  { name: "Express", aliases: ["Express.js"], caseSensitive: true },
  { name: "NestJS", aliases: ["Nest.js"] },
  { name: "Fastify" },
  { name: "GraphQL" },
  { name: "REST", caseSensitive: true },
  { name: "gRPC" },
  { name: "HTML", caseSensitive: true },
  { name: "CSS", caseSensitive: true },
  { name: "Tailwind", aliases: ["Tailwind CSS"] },
  { name: "Python", caseSensitive: true },
  { name: "Django", caseSensitive: true },
  { name: "Flask", caseSensitive: true },
  { name: "FastAPI" },
  { name: "Java", caseSensitive: true },
  { name: "Spring Boot", aliases: ["SpringBoot"] },
  { name: "Kotlin", caseSensitive: true },
  { name: "Scala", caseSensitive: true },
  { name: "Golang" },
  { name: "Rust", caseSensitive: true },
  { name: "C++", caseSensitive: true },
  { name: "C#", caseSensitive: true },
  { name: ".NET", aliases: ["dotnet"] },
  { name: "Ruby", caseSensitive: true },
  { name: "Ruby on Rails", aliases: ["Rails"], caseSensitive: true },
  { name: "PHP", caseSensitive: true },
  { name: "Laravel", caseSensitive: true },
  { name: "Elixir", caseSensitive: true },
  { name: "Swift", caseSensitive: true },
  { name: "SwiftUI" },
  { name: "Flutter", caseSensitive: true },
  { name: "Dart", caseSensitive: true },
  { name: "SQL", caseSensitive: true },
  { name: "PostgreSQL", aliases: ["Postgres"] },
  { name: "MySQL" },
  { name: "SQLite" },
  { name: "MongoDB", aliases: ["Mongo"], caseSensitive: true },
  { name: "Redis", caseSensitive: true },
  { name: "Elasticsearch", aliases: ["OpenSearch"] },
  { name: "DynamoDB" },
  { name: "Cassandra", caseSensitive: true },
  { name: "ClickHouse" },
  { name: "Snowflake", caseSensitive: true },
  { name: "BigQuery" },
  { name: "Kafka", aliases: ["Apache Kafka"], caseSensitive: true },
  { name: "RabbitMQ" },
  { name: "Spark", aliases: ["Apache Spark"], caseSensitive: true },
  { name: "Airflow", aliases: ["Apache Airflow"], caseSensitive: true },
  { name: "dbt", caseSensitive: true },
  { name: "Docker", caseSensitive: true },
  { name: "Kubernetes", aliases: ["K8s"], caseSensitive: true },
  { name: "Helm", caseSensitive: true },
  { name: "Terraform", caseSensitive: true },
  { name: "Ansible", caseSensitive: true },
  { name: "AWS", aliases: ["Amazon Web Services"], caseSensitive: true },
  { name: "GCP", aliases: ["Google Cloud"], caseSensitive: true },
  { name: "Azure", caseSensitive: true },
  { name: "Lambda", caseSensitive: true },
  { name: "Linux", caseSensitive: true },
  { name: "Git", caseSensitive: true },
  { name: "GitHub Actions" },
  { name: "Jenkins", caseSensitive: true },
  { name: "CI/CD", caseSensitive: true },
  { name: "Prometheus", caseSensitive: true },
  { name: "Grafana", caseSensitive: true },
  { name: "OpenTelemetry" },
  { name: "Datadog", caseSensitive: true },
  { name: "Nginx", aliases: ["NGINX"] },
  { name: "PyTorch" },
  { name: "TensorFlow" },
  { name: "scikit-learn" },
  { name: "Pandas", caseSensitive: true },
  { name: "NumPy" },
  { name: "LangChain" },
  { name: "Machine Learning", aliases: ["machine learning"] },
  { name: "LLM", aliases: ["LLMs"], caseSensitive: true },
  { name: "Jest", caseSensitive: true },
  { name: "Vitest" },
  { name: "Playwright", caseSensitive: true },
  { name: "Cypress", caseSensitive: true },
  { name: "Selenium", caseSensitive: true },
  { name: "Figma", caseSensitive: true },
  { name: "Webpack", caseSensitive: true },
  { name: "Vite", caseSensitive: true },
  { name: "OAuth", aliases: ["OAuth2", "OAuth 2.0"] },
  { name: "WebSockets", aliases: ["WebSocket"] },
  { name: "Microservices", aliases: ["microservices"] },
  { name: "Agile", caseSensitive: true },
  { name: "Scrum", caseSensitive: true },
];

/** Characters that may not touch a skill name on either side, so "Java" never matches "JavaScript". */
const WORD_CHARACTER = "A-Za-z0-9+#";

/** Escapes characters that have a special meaning in a regular expression. */
function escapePattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** One compiled matcher per vocabulary entry. */
interface CompiledEntry {
  name: string;
  pattern: RegExp;
}

/** The vocabulary compiled once into regular expressions. */
const COMPILED_VOCABULARY: CompiledEntry[] = VOCABULARY.map((entry) => {
  const spellings = [entry.name, ...(entry.aliases ?? [])].map(escapePattern);
  const pattern = new RegExp(
    `(?<![${WORD_CHARACTER}])(?:${spellings.join("|")})(?![${WORD_CHARACTER}])`,
    entry.caseSensitive ? "" : "i",
  );
  return { name: entry.name, pattern };
});

/**
 * Returns the technologies named in `text`, each once, in the order they first appear.
 *
 * Example: "We use Node.js, TypeScript and Postgres." gives
 * `["Node.js", "TypeScript", "PostgreSQL"]`. "Java" does not match inside "JavaScript".
 */
export function extractSkills(text: string): string[] {
  const found: { name: string; position: number }[] = [];
  for (const entry of COMPILED_VOCABULARY) {
    const match = entry.pattern.exec(text);
    if (match) found.push({ name: entry.name, position: match.index });
  }
  found.sort((first, second) => first.position - second.position);
  return found.map((skill) => skill.name);
}
