import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createNeo4jDriver } from "./neo4j-config.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..", "..");

const toCamelCase = (value: string) =>
  value.length ? `${value[0].toLowerCase()}${value.slice(1)}` : value;

const resolveSourcePath = (filePath: string) => {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  const normalized = path.normalize(filePath).replace(/^[/\\]+/, "");
  const apiPrefix = path.normalize(path.join("apps", "core-api", "src"));

  if (normalized.startsWith(apiPrefix)) {
    return path.resolve(repoRoot, normalized);
  }

  return path.resolve(repoRoot, "apps", "core-api", "src", normalized);
};

const matchesModelUsage = (fileText: string, modelName: string) => {
  const camelName = toCamelCase(modelName);
  const prismaPattern = new RegExp(`\\bprisma\\s*\\.\\s*${camelName}\\b`);
  const modelPattern = new RegExp(`\\b${modelName}\\b`);
  return prismaPattern.test(fileText) || modelPattern.test(fileText);
};

const linkCodeToDb = async () => {
  const driver = createNeo4jDriver();
  const session = driver.session();

  try {
    const modelResult = await session.run(
      "MATCH (m:DatabaseModel) RETURN m.name as name"
    );
    const fileResult = await session.run(
      "MATCH (c:CodeFile) RETURN c.path as path"
    );

    const modelNames = modelResult.records
      .map((record) => record.get("name"))
      .filter((name): name is string => typeof name === "string");
    const filePaths = fileResult.records
      .map((record) => record.get("path"))
      .filter((pathValue): pathValue is string => typeof pathValue === "string");

    let bridgeCount = 0;

    for (const filePath of filePaths) {
      const absolutePath = resolveSourcePath(filePath);
      if (!fs.existsSync(absolutePath)) {
        console.warn(`Skipping missing file: ${absolutePath}`);
        continue;
      }
      const fileText = fs.readFileSync(absolutePath, "utf8");
      const fileName = path.basename(filePath);

      for (const modelName of modelNames) {
        if (matchesModelUsage(fileText, modelName)) {
          await session.run(
            "MATCH (c:CodeFile {path: $filePath}), (m:DatabaseModel {name: $modelName}) MERGE (c)-[:QUERIES_DB]->(m)",
            { filePath, modelName }
          );
          console.log(`Bridged: ${fileName} -> ${modelName}`);
          bridgeCount += 1;
        }
      }
    }

    console.log(`Created ${bridgeCount} QUERIES_DB relationships.`);
  } finally {
    await session.close();
    await driver.close();
  }
};

linkCodeToDb().catch((error) => {
  console.error("Linking failed.", error);
  process.exitCode = 1;
});
