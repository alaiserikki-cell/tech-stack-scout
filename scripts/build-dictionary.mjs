// Generates data/tech-dictionary.json. Run: node scripts/build-dictionary.mjs
// Aliases are lowercase and matched with word boundaries against job posts and blog text.
// Ambiguous words (go, rust, swift, spark, ...) only appear in phrases that carry tech context.
// verify:true entries are excluded from matching until marked verified in /settings.
import { writeFileSync } from "node:fs";

const out = [];
function t(canonical_name, category, aliases = [], o = {}) {
  out.push({
    canonical_name,
    category,
    aliases: [...new Set([canonical_name.toLowerCase(), ...aliases].filter((a) => !o.noSelf || a !== canonical_name.toLowerCase()))],
    detection_files: o.files ?? [],
    dependency_names: o.deps ?? [],
    verify: o.verify ?? false,
  });
}
const L = (n, a, o) => t(n, "language", a, o);
const F = (n, a, o) => t(n, "framework", a, o);
const C = (n, a, o) => t(n, "cloud", a, o);
const I = (n, a, o) => t(n, "infra", a, o);
const CI = (n, a, o) => t(n, "ci", a, o);
const T = (n, a, o) => t(n, "test_framework", a, o);
const D = (n, a, o) => t(n, "data", a, o);
const O = (n, a, o) => t(n, "observability", a, o);
const P = (n, a, o) => t(n, "pattern", a, o);

// ---------- languages (canonical names match GitHub's linguist names) ----------
L("Go", ["golang", "go developer", "go engineer", "written in go", "go services", "go microservices", "experience with go", "go programming"], { noSelf: true, files: ["go.mod"] });
L("Java", ["java 17", "java 21", "java developer", "java engineer"], { files: ["pom.xml"] });
L("Kotlin", [], { files: ["build.gradle.kts"] });
L("Python", ["python3"], { files: ["requirements.txt", "pyproject.toml"] });
L("TypeScript", [], { files: ["tsconfig.json"] });
L("JavaScript", ["node.js", "nodejs", "ecmascript"], { files: ["package.json"] });
L("Ruby", ["ruby developer", "ruby engineer"], { noSelf: true, files: ["Gemfile"] });
L("Rust", ["rust programming", "rust developer", "rust engineer", "written in rust", "rustlang", "experience with rust", "rust services"], { noSelf: true, files: ["Cargo.toml"] });
L("Scala", [], { files: ["build.sbt"] });
L("C#", [".net developer", "c# developer", "csharp"], { files: ["*.csproj"] });
L("C++", ["cpp", "modern c++"]);
L("C", ["c programming", "embedded c"], { noSelf: true });
L("PHP", [], { files: ["composer.json"] });
L("Swift", ["swift developer", "swift engineer", "swiftui", "ios swift", "swift and objective-c"], { noSelf: true, files: ["Package.swift"] });
L("Objective-C", ["objective c", "objc"]);
L("Elixir", [], { files: ["mix.exs"] });
L("Erlang", []);
L("Clojure", []);
L("Haskell", []);
L("Dart", ["dart language"], { noSelf: true, files: ["pubspec.yaml"] });
L("Shell", ["bash scripting", "shell scripting"], { noSelf: true });
L("HCL", []);
L("Lua", []);
L("R", ["r programming", "r language", "rstats"], { noSelf: true });
L("Julia", ["julia language"], { noSelf: true });
L("Zig", ["zig language", "ziglang"], { noSelf: true });
L("OCaml", []);
L("F#", ["fsharp"]);
L("Groovy", []);
L("Perl", []);
L("Solidity", []);

// ---------- frameworks ----------
F("React", ["reactjs", "react.js"], { deps: ["react"] });
F("Next.js", ["nextjs"], { deps: ["next"] });
F("Vue.js", ["vuejs", "vue", "vue 3"], { deps: ["vue"] });
F("Nuxt", ["nuxt.js", "nuxtjs"], { deps: ["nuxt"] });
F("Angular", ["angularjs"], { deps: ["@angular/core"] });
F("Svelte", ["sveltekit"], { deps: ["svelte"] });
F("Express", ["express.js", "expressjs", "express framework"], { noSelf: true, deps: ["express"] });
F("NestJS", ["nest.js"], { deps: ["@nestjs/core"] });
F("Fastify", [], { deps: ["fastify"] });
F("GraphQL", [], { deps: ["graphql", "@apollo/server", "apollo-server", "graphene", "github.com/99designs/gqlgen"] });
F("gRPC", ["protobuf", "protocol buffers"], { deps: ["@grpc/grpc-js", "grpcio", "google.golang.org/grpc", "io.grpc"] });
F("Django", [], { deps: ["django"] });
F("Flask", [], { deps: ["flask"] });
F("FastAPI", [], { deps: ["fastapi"] });
F("Celery", [], { deps: ["celery"] });
F("Spring Boot", ["spring framework", "springboot"], { deps: ["org.springframework.boot", "spring-boot-starter"] });
F("Ruby on Rails", ["rails"], { deps: ["rails"] });
F("Sinatra", [], { deps: ["sinatra"] });
F("Laravel", [], { deps: ["laravel/framework"] });
F("Symfony", [], { deps: ["symfony/symfony"] });
F("ASP.NET Core", ["asp.net", ".net core", "dotnet core"]);
F("Gin", ["gin-gonic"], { noSelf: true, deps: ["github.com/gin-gonic/gin"] });
F("Echo (Go)", ["labstack echo"], { noSelf: true, deps: ["github.com/labstack/echo"] });
F("Phoenix", ["phoenix framework", "elixir phoenix"], { noSelf: true });
F("React Native", [], { deps: ["react-native"] });
F("Flutter", [], { deps: ["flutter"] });
F("Electron", ["electron.js", "electron app"], { noSelf: true, deps: ["electron"] });
F("Ktor", [], { deps: ["io.ktor"] });
F("Micronaut", [], { deps: ["io.micronaut"] });
F("Quarkus", [], { deps: ["io.quarkus"] });
F("Tailwind CSS", ["tailwindcss", "tailwind"], { deps: ["tailwindcss"] });
F("Remix", ["remix.run"], { noSelf: true, deps: ["@remix-run/react"] });
F("tRPC", [], { deps: ["@trpc/server"] });
F("Pydantic", [], { deps: ["pydantic"] });
F("PyTorch", [], { deps: ["torch"] });
F("TensorFlow", [], { deps: ["tensorflow"] });
F("scikit-learn", ["sklearn"], { deps: ["scikit-learn"] });
F("LangChain", [], { deps: ["langchain", "@langchain/core"] });

// ---------- cloud ----------
C("AWS", ["amazon web services", "aws lambda", "amazon s3", "aws cloud"], { deps: ["@aws-sdk/*", "aws-sdk", "boto3", "botocore", "github.com/aws/aws-sdk-go", "github.com/aws/aws-sdk-go-v2", "software.amazon.awssdk"] });
C("Google Cloud", ["gcp", "google cloud platform", "cloud run"], { deps: ["@google-cloud/*", "google-cloud-storage", "google-cloud-bigquery", "cloud.google.com/go", "com.google.cloud"] });
C("Azure", ["microsoft azure", "azure devops", "aks"], { deps: ["@azure/*", "azure-storage-blob", "azure-identity", "github.com/azure/azure-sdk-for-go", "com.azure"] });
C("Cloudflare", ["cloudflare workers"], { files: ["wrangler.toml"], deps: ["wrangler", "@cloudflare/workers-types"] });
C("Vercel", [], { files: ["vercel.json"], deps: ["vercel", "@vercel/*"] });
C("Netlify", [], { files: ["netlify.toml"] });
C("Heroku", [], { files: ["Procfile", "app.json"], verify: true });
C("DigitalOcean", [], { deps: ["github.com/digitalocean/godo"] });
C("Fly.io", [], { files: ["fly.toml"] });
C("Firebase", [], { files: ["firebase.json"], deps: ["firebase", "firebase-admin"] });
C("Supabase", [], { deps: ["@supabase/supabase-js"] });
C("Oracle Cloud", ["oracle cloud infrastructure"]);
C("Alibaba Cloud", ["aliyun"]);
C("AWS Lambda", ["lambda functions", "serverless lambda"], { files: ["template.yaml"], verify: true });
C("Amazon ECS", ["ecs fargate", "aws fargate", "fargate"]);
C("Amazon EKS", ["eks"]);
C("Google Kubernetes Engine", ["gke"]);

// ---------- infra ----------
I("Docker", ["dockerfile", "docker compose"], { files: ["Dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yaml"] });
I("Kubernetes", ["k8s"], { files: ["kustomization.yaml", "skaffold.yaml"] });
I("Helm", ["helm charts"], { files: ["Chart.yaml"] });
I("Terraform", [], { files: ["*.tf"] });
I("Pulumi", [], { files: ["Pulumi.yaml"], deps: ["@pulumi/pulumi", "pulumi"] });
I("AWS CDK", ["cdk", "cloud development kit"], { files: ["cdk.json"], deps: ["aws-cdk-lib", "aws-cdk"] });
I("CloudFormation", ["aws cloudformation"]);
I("Serverless Framework", ["serverless.yml"], { files: ["serverless.yml", "serverless.yaml"], deps: ["serverless"] });
I("Ansible", [], { files: ["ansible.cfg", "playbook.yml"] });
I("Chef", ["chef infra"], { noSelf: true });
I("Puppet", []);
I("Nomad", ["hashicorp nomad"], { noSelf: true, files: ["*.nomad"] });
I("Consul", ["hashicorp consul"], { noSelf: true });
I("Vault", ["hashicorp vault"], { noSelf: true });
I("Istio", []);
I("Linkerd", []);
I("Envoy", ["envoy proxy"], { noSelf: true });
I("Nginx", [], { files: ["nginx.conf"] });
I("Argo CD", ["argocd", "argo cd"]);
I("Flux", ["fluxcd", "flux cd"], { noSelf: true });
I("Bazel", [], { files: ["BUILD.bazel", "WORKSPACE", "MODULE.bazel", ".bazelrc"] });
I("Nx", ["nx monorepo", "nrwl nx"], { noSelf: true, files: ["nx.json"], deps: ["nx"] });
I("Turborepo", ["turbo repo"], { files: ["turbo.json"], deps: ["turbo"] });
I("pnpm workspaces", ["pnpm workspace"], { files: ["pnpm-workspace.yaml"] });
I("Lerna", [], { files: ["lerna.json"], deps: ["lerna"] });
I("Gradle", [], { files: ["build.gradle", "build.gradle.kts", "settings.gradle"] });
I("Maven", ["apache maven"], { files: ["pom.xml"] });
I("Pants", ["pantsbuild", "pants build"], { noSelf: true, files: ["pants.toml"] });
I("Packer", ["hashicorp packer"], { noSelf: true, files: ["*.pkr.hcl"] });
I("Crossplane", []);
I("OpenTofu", []);
I("Dev Containers", ["devcontainer"], { files: [".devcontainer/devcontainer.json"] });

// ---------- CI ----------
CI("GitHub Actions", ["github action"], { files: [".github/workflows/*.yml", ".github/workflows/*.yaml"] });
CI("CircleCI", ["circle ci"], { files: [".circleci/config.yml"] });
CI("Jenkins", ["jenkinsfile"], { files: ["Jenkinsfile"] });
CI("Buildkite", [], { files: [".buildkite/pipeline.yml", ".buildkite/pipeline.yaml"] });
CI("GitLab CI", ["gitlab ci/cd", "gitlab-ci", "gitlab pipelines"], { files: [".gitlab-ci.yml"] });
CI("Travis CI", ["travis"], { files: [".travis.yml"] });
CI("Azure Pipelines", [], { files: ["azure-pipelines.yml"] });
CI("Drone CI", ["drone.io"], { files: [".drone.yml"] });
CI("TeamCity", [], { files: [".teamcity/settings.kts"] });
CI("Bitbucket Pipelines", [], { files: ["bitbucket-pipelines.yml"] });
CI("AppVeyor", [], { files: ["appveyor.yml"] });
CI("Google Cloud Build", ["cloud build"], { files: ["cloudbuild.yaml", "cloudbuild.yml"] });
CI("AWS CodeBuild", ["codebuild"], { files: ["buildspec.yml"] });
CI("Spinnaker", []);
CI("Tekton", []);
CI("Semaphore CI", ["semaphoreci"], { files: [".semaphore/semaphore.yml"] });
CI("Earthly", [], { files: ["Earthfile"] });
CI("Dagger", ["dagger.io"], { noSelf: true, files: ["dagger.json"] });
CI("Renovate", ["renovate bot", "renovatebot"], { noSelf: true, files: ["renovate.json"] });
CI("Dependabot", [], { files: [".github/dependabot.yml"] });
CI("pre-commit", [], { files: [".pre-commit-config.yaml"] });
CI("Codecov", [], { files: ["codecov.yml", ".codecov.yml"] });
CI("SonarQube", ["sonarcloud", "sonar"], { files: ["sonar-project.properties"] });

// ---------- test frameworks ----------
T("Jest", [], { files: ["jest.config.js", "jest.config.ts"], deps: ["jest", "ts-jest", "@jest/globals"] });
T("Vitest", [], { files: ["vitest.config.ts", "vitest.config.js"], deps: ["vitest"] });
T("Mocha", ["mochajs"], { deps: ["mocha"] });
T("Jasmine", ["jasmine tests", "jasmine testing"], { noSelf: true, deps: ["jasmine"] });
T("Cypress", [], { files: ["cypress.config.ts", "cypress.config.js", "cypress.json"], deps: ["cypress"] });
T("Playwright", [], { files: ["playwright.config.ts", "playwright.config.js"], deps: ["@playwright/test", "playwright"] });
T("Selenium", ["webdriver"], { deps: ["selenium", "selenium-webdriver", "org.seleniumhq.selenium"] });
T("WebdriverIO", ["wdio"], { deps: ["webdriverio", "@wdio/cli"] });
T("Puppeteer", [], { deps: ["puppeteer"] });
T("Testing Library", ["react testing library"], { deps: ["@testing-library/react", "@testing-library/jest-dom"] });
T("Storybook", [], { deps: ["storybook", "@storybook/react"] });
T("pytest", [], { files: ["pytest.ini", "conftest.py"], deps: ["pytest", "pytest-xdist", "pytest-cov"] });
T("unittest", ["python unittest"], { noSelf: true });
T("tox", [], { files: ["tox.ini"], deps: ["tox"] });
T("Hypothesis", ["property-based testing"], { noSelf: true, deps: ["hypothesis"] });
T("JUnit", ["junit5", "junit 5"], { deps: ["junit", "org.junit.jupiter", "junit-jupiter"] });
T("TestNG", [], { deps: ["org.testng", "testng"] });
T("Mockito", [], { deps: ["org.mockito", "mockito-core"] });
T("Kotest", [], { deps: ["io.kotest"] });
T("Testcontainers", [], { deps: ["testcontainers", "org.testcontainers", "github.com/testcontainers/testcontainers-go"] });
T("testify", [], { deps: ["github.com/stretchr/testify"] });
T("Ginkgo", [], { deps: ["github.com/onsi/ginkgo", "github.com/onsi/ginkgo/v2"] });
T("Gomega", [], { deps: ["github.com/onsi/gomega"] });
T("RSpec", [], { files: [".rspec"], deps: ["rspec", "rspec-rails"] });
T("Minitest", [], { deps: ["minitest"] });
T("Capybara", [], { deps: ["capybara"] });
T("PHPUnit", [], { files: ["phpunit.xml"], deps: ["phpunit/phpunit"] });
T("xUnit", ["xunit.net"]);
T("NUnit", []);
T("k6", ["grafana k6", "k6 load testing"], { noSelf: true, deps: ["k6"] });
T("Gatling", []);
T("Locust", ["locust load testing"], { noSelf: true, deps: ["locust"] });
T("Pact", ["contract testing", "pact contract"], { noSelf: true, deps: ["@pact-foundation/pact", "pact-python"] });
T("Detox", ["detox e2e", "detox testing"], { noSelf: true, deps: ["detox"] });
T("Appium", [], { deps: ["appium"] });
T("XCTest", []);
T("Espresso", ["android espresso"], { noSelf: true });

// ---------- data ----------
D("PostgreSQL", ["postgres", "postgresql", "psql"], { deps: ["pg", "psycopg2", "psycopg", "asyncpg", "github.com/lib/pq", "github.com/jackc/pgx", "org.postgresql"] });
D("MySQL", ["mariadb"], { deps: ["mysql", "mysql2", "pymysql", "github.com/go-sql-driver/mysql"] });
D("MongoDB", ["mongo db"], { deps: ["mongodb", "mongoose", "pymongo", "go.mongodb.org/mongo-driver"] });
D("Redis", [], { deps: ["redis", "ioredis", "github.com/redis/go-redis", "github.com/go-redis/redis"] });
D("Elasticsearch", ["elastic search"], { deps: ["@elastic/elasticsearch", "elasticsearch"] });
D("OpenSearch", [], { deps: ["@opensearch-project/opensearch", "opensearch-py"] });
D("Apache Kafka", ["kafka"], { deps: ["kafkajs", "confluent-kafka", "github.com/segmentio/kafka-go", "org.apache.kafka"] });
D("RabbitMQ", ["amqp"], { deps: ["amqplib", "pika"] });
D("Apache Spark", ["pyspark", "spark streaming", "spark sql", "apache spark"], { noSelf: true, deps: ["pyspark", "org.apache.spark"] });
D("Apache Flink", ["flink"], {});
D("Apache Airflow", ["airflow"], { deps: ["apache-airflow"] });
D("dbt", ["data build tool", "dbt core"], { files: ["dbt_project.yml"], deps: ["dbt-core"] });
D("Snowflake", ["snowflake data"], { deps: ["snowflake-connector-python", "snowflake-sdk"] });
D("BigQuery", ["google bigquery"], { deps: ["@google-cloud/bigquery", "google-cloud-bigquery"] });
D("Amazon Redshift", ["redshift"]);
D("Databricks", [], { deps: ["databricks-sdk", "databricks-connect"] });
D("ClickHouse", [], { deps: ["@clickhouse/client", "clickhouse-connect"] });
D("Cassandra", ["apache cassandra"], { deps: ["cassandra-driver"] });
D("DynamoDB", ["amazon dynamodb"], { deps: ["@aws-sdk/client-dynamodb"] });
D("SQLite", [], { deps: ["sqlite3", "better-sqlite3"] });
D("CockroachDB", ["cockroach db"]);
D("Prisma", [], { deps: ["prisma", "@prisma/client"] });
D("SQLAlchemy", [], { deps: ["sqlalchemy"] });
D("Hibernate", [], { deps: ["org.hibernate"] });
D("Pandas", [], { deps: ["pandas"] });
D("Apache Beam", [], { deps: ["apache-beam"] });
D("Trino", ["presto"], {});
D("Pinecone", [], { deps: ["@pinecone-database/pinecone", "pinecone-client"] });
D("Amazon SQS", ["sqs"], { deps: ["@aws-sdk/client-sqs"] });
D("NATS", ["nats.io"], { deps: ["nats", "github.com/nats-io/nats.go"] });
D("Temporal", ["temporal.io", "temporal workflows"], { noSelf: true, deps: ["@temporalio/client", "go.temporal.io/sdk", "temporalio"] });

// ---------- observability ----------
O("Datadog", [], { deps: ["dd-trace", "ddtrace", "datadog-api-client", "@datadog/browser-rum"] });
O("Prometheus", [], { files: ["prometheus.yml"], deps: ["prom-client", "prometheus-client", "prometheus_client", "github.com/prometheus/client_golang"] });
O("Grafana", [], {});
O("OpenTelemetry", ["otel"], { deps: ["@opentelemetry/api", "@opentelemetry/sdk-node", "opentelemetry-api", "opentelemetry-sdk", "go.opentelemetry.io/otel", "io.opentelemetry"] });
O("Sentry", [], { deps: ["@sentry/node", "@sentry/react", "@sentry/nextjs", "sentry-sdk", "github.com/getsentry/sentry-go"] });
O("New Relic", ["newrelic"], { deps: ["newrelic"] });
O("Honeycomb", [], { deps: ["@honeycombio/opentelemetry-node"] });
O("Splunk", [], {});
O("ELK Stack", ["elk stack", "kibana", "logstash"], { noSelf: true });
O("Jaeger", ["jaeger tracing"], {});
O("PagerDuty", [], {});
O("Grafana Loki", ["loki"], { noSelf: true });
O("Amazon CloudWatch", ["cloudwatch"], {});
O("Dynatrace", [], {});
O("Bugsnag", [], { deps: ["@bugsnag/js"] });
O("Rollbar", [], { deps: ["rollbar"] });

// ---------- patterns ----------
P("microservices", ["microservice", "micro-services", "service-oriented architecture", "distributed services"]);
P("monorepo", ["mono-repo", "mono repo"]);
P("platform team", ["platform engineering", "platform engineer", "internal developer platform", "platform team"]);
P("developer productivity", ["developer experience", "devex", "dev productivity", "engineering productivity", "developer tooling"]);
P("test infrastructure", ["test infra", "testing infrastructure", "test automation infrastructure", "test tooling"]);
P("CI reliability", ["flaky tests", "flaky test", "ci reliability", "build reliability", "build times", "ci/cd reliability", "ci pipeline reliability"]);
P("event-driven architecture", ["event-driven", "event sourcing", "cqrs"]);
P("serverless", ["serverless architecture", "faas"]);
P("infrastructure as code", ["iac"]);
P("GitOps", []);
P("site reliability engineering", ["sre", "site reliability"]);
P("feature flags", ["feature flagging", "launchdarkly"]);
P("trunk-based development", ["trunk based development"]);
P("continuous deployment", ["continuous delivery", "ci/cd"]);
P("chaos engineering", []);
P("service mesh", []);

// sanity checks
const names = new Set();
for (const e of out) {
  if (names.has(e.canonical_name)) throw new Error("duplicate " + e.canonical_name);
  names.add(e.canonical_name);
  for (const a of e.aliases) if (a !== a.toLowerCase()) throw new Error("alias not lowercase: " + a);
}
if (out.length < 150 || out.length > 250) throw new Error("dictionary size out of range: " + out.length);
writeFileSync(new URL("../data/tech-dictionary.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
const byCat = out.reduce((m, e) => ((m[e.category] = (m[e.category] ?? 0) + 1), m), {});
console.log(out.length, "entries", byCat, "verify:true ->", out.filter((e) => e.verify).map((e) => e.canonical_name));
