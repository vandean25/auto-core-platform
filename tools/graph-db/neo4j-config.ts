import neo4j from "neo4j-driver";

const DEFAULT_NEO4J_URI = "bolt://localhost:7687";

export const NEO4J_URI = process.env.NEO4J_URI ?? DEFAULT_NEO4J_URI;
export const NEO4J_USERNAME =
  process.env.NEO4J_USERNAME ?? process.env.NEO4J_USER ?? "";
export const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD ?? "";

export const ensureNeo4jEnv = () => {
  if (!NEO4J_USERNAME || !NEO4J_PASSWORD) {
    throw new Error(
      "Missing Neo4j credentials. Set NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD.",
    );
  }
};

export const createNeo4jDriver = () => {
  ensureNeo4jEnv();
  return neo4j.driver(
    NEO4J_URI,
    neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD),
  );
};
