import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import neo4j from "neo4j-driver";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..", "..");
const schemaPath = path.join(
  repoRoot,
  "apps",
  "core-api",
  "prisma",
  "schema.prisma"
);

const readSchema = async () => fs.readFile(schemaPath, "utf8");

const extractModels = (schemaText: string) => {
  const regex = /model\s+(\w+)\s*\{/g;
  const models = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(schemaText))) {
    models.add(match[1]);
  }

  return Array.from(models);
};

const extractModelBlocks = (schemaText: string) => {
  const regex = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  const blocks: Array<{ name: string; body: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(schemaText))) {
    blocks.push({ name: match[1], body: match[2] });
  }

  return blocks;
};

const extractRelationships = (
  schemaText: string,
  modelNames: string[]
) => {
  const modelSet = new Set(modelNames);
  const edges = new Set<string>();
  const blocks = extractModelBlocks(schemaText);

  for (const block of blocks) {
    const lines = block.body.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) {
        continue;
      }
      const match = line.match(/^(\w+)\s+([A-Za-z_][\w\[\]\?]*)/);
      if (!match) {
        continue;
      }
      const typeToken = match[2];
      const targetModel = typeToken.replace(/\[\]|\?/g, "");
      if (modelSet.has(targetModel) && targetModel !== block.name) {
        edges.add(`${block.name}::${targetModel}`);
      }
    }
  }

  return Array.from(edges).map((edge) => {
    const [sourceModel, targetModel] = edge.split("::");
    return { sourceModel, targetModel };
  });
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const waitForNeo4j = async (driver: neo4j.Driver) => {
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await driver.verifyConnectivity();
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      console.log(`Waiting for Neo4j... (${attempt}/${maxAttempts})`);
      await sleep(2000);
    }
  }
};

const ingestModels = async () => {
  const driver = neo4j.driver(
    "bolt://localhost:7687",
    neo4j.auth.basic("neo4j", "autocore123")
  );
  const session = driver.session();

  try {
    await waitForNeo4j(driver);
    const schemaText = await readSchema();
    const models = extractModels(schemaText);
    const relationships = extractRelationships(schemaText, models);

    if (models.length === 0) {
      console.log("No models found in schema.prisma.");
      return;
    }

    for (const modelName of models) {
      await session.run("MERGE (m:DatabaseModel {name: $modelName})", {
        modelName
      });
      console.log(`Added Node: ${modelName}`);
    }

    for (const relation of relationships) {
      await session.run(
        "MATCH (a:DatabaseModel {name: $sourceModel}), (b:DatabaseModel {name: $targetModel}) MERGE (a)-[:RELATES_TO]->(b)",
        relation
      );
      console.log(
        `Created Edge: ${relation.sourceModel} -> ${relation.targetModel}`
      );
    }
  } finally {
    await session.close();
    await driver.close();
  }
};

ingestModels().catch((error) => {
  console.error("Ingestion failed.", error);
  process.exitCode = 1;
});
