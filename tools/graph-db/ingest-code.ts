import path from "node:path";
import { fileURLToPath } from "node:url";

import madge from "madge";
import neo4j from "neo4j-driver";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..", "..");
const targetPath = path.join(repoRoot, "apps", "core-api", "src");

const ingestCode = async () => {
  const driver = neo4j.driver(
    "neo4j://localhost:7687",
    neo4j.auth.basic("neo4j", "autocore123")
  );
  const session = driver.session();

  try {
    const result = await madge(targetPath, {
      fileExtensions: ["ts"]
    });
    const graph = result.obj();
    const files = new Set<string>();

    for (const [source, imports] of Object.entries(graph)) {
      files.add(source);
      for (const imported of imports) {
        files.add(imported);
      }
    }

    for (const filePath of files) {
      const fileName = path.basename(filePath);
      await session.run(
        "MERGE (f:CodeFile {path: $filePath}) SET f.name = $fileName",
        { filePath, fileName }
      );
    }

    let edgeCount = 0;
    for (const [sourcePath, imports] of Object.entries(graph)) {
      for (const targetPath of imports) {
        await session.run(
          "MATCH (a:CodeFile {path: $sourcePath}), (b:CodeFile {path: $targetPath}) MERGE (a)-[:IMPORTS]->(b)",
          { sourcePath, targetPath }
        );
        edgeCount += 1;
      }
    }

    console.log(
      `Analyzed ${files.size} files and created ${edgeCount} import relationships.`
    );
  } finally {
    await session.close();
    await driver.close();
  }
};

ingestCode().catch((error) => {
  console.error("Code ingestion failed.", error);
  process.exitCode = 1;
});
