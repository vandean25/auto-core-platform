import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import neo4j from "neo4j-driver";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..", "..");

const toCamelCase = (value: string) =>
  value.length ? `${value[0].toLowerCase()}${value.slice(1)}` : value;

const linkCodeToDb = async () => {
  const driver = neo4j.driver(
    "neo4j://localhost:7687",
    neo4j.auth.basic("neo4j", "autocore123")
  );
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
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(repoRoot, "apps", "core-api", "src", filePath);
      const fileText = fs.readFileSync(absolutePath, "utf8");
      const fileName = path.basename(filePath);

      for (const modelName of modelNames) {
        const camelName = toCamelCase(modelName);
        if (
          fileText.includes(`prisma.${camelName}`) ||
          fileText.includes(modelName)
        ) {
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
