#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_SCHEMA_PATH = path.resolve(
  import.meta.dirname,
  '../../apps/core-api/prisma/schema.prisma',
);

function withoutComments(schema) {
  return schema
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function parseList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseModels(schema) {
  const models = [];
  const modelPattern = /^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm;

  for (const match of withoutComments(schema).matchAll(modelPattern)) {
    const [, name, body] = match;
    const fields = new Map();
    const relations = [];
    let table = name;

    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;

      const mapMatch = line.match(/^@@map\("([^"]+)"\)/);
      if (mapMatch) {
        table = mapMatch[1];
        continue;
      }

      if (line.startsWith('@@')) continue;

      const fieldMatch = line.match(
        /^(\w+)\s+(\w+)(\[\]|\?)?(?:\s+(.+))?$/,
      );
      if (!fieldMatch) continue;

      const [, field, type, modifier = '', attributes = ''] = fieldMatch;
      const dbField =
        attributes.match(/@map\("([^"]+)"\)/)?.[1] ?? field;
      fields.set(field, {
        dbField,
        nullable: modifier === '?' || type.endsWith('?'),
      });

      const relationMatch = attributes.match(/@relation\((.*)\)/);
      if (!relationMatch) continue;

      const relationArgs = relationMatch[1];
      const quotedName = relationArgs.match(/^"([^"]+)"/)?.[1];
      const fieldsMatch = relationArgs.match(/fields:\s*\[([^\]]+)\]/);
      const referencesMatch = relationArgs.match(
        /references:\s*\[([^\]]+)\]/,
      );

      relations.push({
        field,
        targetModel: type,
        relationName: quotedName,
        fields: fieldsMatch ? parseList(fieldsMatch[1]) : [],
        references: referencesMatch ? parseList(referencesMatch[1]) : [],
      });
    }

    models.push({ name, table, fields, relations });
  }

  return models;
}

function tableForModel(models, modelName) {
  return models.find((model) => model.name === modelName)?.table;
}

function dbFields(model, fieldNames) {
  return fieldNames.map(
    (fieldName) => model.fields.get(fieldName)?.dbField ?? fieldName,
  );
}

function explicitRelations(models) {
  return models.flatMap((model) =>
    model.relations
      .filter((relation) => relation.fields.length > 0)
      .map((relation) => ({
        ...relation,
        model: model.name,
        table: model.table,
        targetTable: tableForModel(models, relation.targetModel),
        columns: dbFields(model, relation.fields),
        parentColumns: dbFields(
          models.find((candidate) => candidate.name === relation.targetModel),
          relation.references,
        ),
      })),
  );
}

function directTenantModels(models) {
  return new Set(
    models
      .filter(
        (model) =>
          model.table !== 'tenants' &&
          [...model.fields.values()].some(
            (field) => field.dbField === 'tenant_id',
          ),
      )
      .map((model) => model.name),
  );
}

function dependentModels(models, directModels) {
  const selected = new Set(directModels);
  let changed = true;
  const relations = explicitRelations(models);

  while (changed) {
    changed = false;
    for (const model of models) {
      if (selected.has(model.name) || model.table === 'users') continue;

      const foreignKeys = relations.filter(
        (relation) => relation.model === model.name,
      );
      if (
        foreignKeys.length > 0 &&
        foreignKeys.some((relation) => selected.has(relation.targetModel)) &&
        foreignKeys.every((relation) => selected.has(relation.targetModel))
      ) {
        selected.add(model.name);
        changed = true;
      }
    }
  }

  return selected;
}

function implicitJoinDefinitions(models, selectedModels) {
  const groups = new Map();
  for (const model of models) {
    for (const relation of model.relations) {
      if (!relation.relationName) continue;
      const group = groups.get(relation.relationName) ?? [];
      group.push({
        model: model.name,
        targetModel: relation.targetModel,
        hasFields: relation.fields.length > 0,
      });
      groups.set(relation.relationName, group);
    }
  }

  return [...groups.entries()]
    .map(([relationName, relations]) => {
      if (relations.some((relation) => relation.hasFields)) return null;
      const endpoints = [...new Set(
        relations.flatMap((relation) => [
          relation.model,
          relation.targetModel,
        ]),
      )].sort();
      if (
        endpoints.length !== 2 ||
        !endpoints.every((model) => selectedModels.has(model))
      ) {
        return null;
      }

      const [firstModel, secondModel] = endpoints;
      return {
        table: `_${relationName}`,
        kind: 'implicit_join',
        dependencies: endpoints.map((model) => tableForModel(models, model)),
        scopeRelations: [
          {
            columns: ['A'],
            parentTable: tableForModel(models, firstModel),
            parentColumns: ['id'],
          },
          {
            columns: ['B'],
            parentTable: tableForModel(models, secondModel),
            parentColumns: ['id'],
          },
        ],
      };
    })
    .filter(Boolean);
}

function orderDefinitions(definitions) {
  const byTable = new Map(
    definitions.map((definition) => [definition.table, definition]),
  );
  const remaining = new Set(byTable.keys());
  const ordered = [];

  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((table) =>
        byTable
          .get(table)
          .dependencies.every(
            (dependency) => !remaining.has(dependency) || dependency === table,
          ),
      )
      .sort();

    if (ready.length === 0) {
      throw new Error(
        `Cannot derive FK-safe order for tenant restore tables: ${[
          ...remaining,
        ].join(', ')}`,
      );
    }

    for (const table of ready) {
      remaining.delete(table);
      ordered.push(byTable.get(table));
    }
  }

  return ordered;
}

function selfReferences(models, selectedModels) {
  return explicitRelations(models)
    .filter(
      (relation) =>
        relation.model === relation.targetModel &&
        selectedModels.has(relation.model),
    )
    .map((relation) => {
      const model = models.find(
        (candidate) => candidate.name === relation.model,
      );
      const columns = dbFields(
        model,
        relation.fields.filter(
          (field) => model.fields.get(field)?.dbField !== 'tenant_id',
        ),
      );
      const nullable = relation.fields
        .filter((field) => model.fields.get(field)?.dbField !== 'tenant_id')
        .every((field) => model.fields.get(field)?.nullable);

      if (!nullable) {
        throw new Error(
          `Self-reference on ${model.table} must use nullable columns: ${columns.join(', ')}`,
        );
      }

      return {
        table: model.table,
        columns,
        nullable,
      };
    })
    .filter((reference) => reference.columns.length > 0);
}

function prePurgeMutations(models) {
  const userModel = models.find((model) => model.table === 'users');
  if (!userModel) return [];

  return explicitRelations(models)
    .filter(
      (relation) =>
        relation.table === 'users' &&
        relation.targetModel === 'Tenant' &&
        relation.columns.includes('active_tenant_id'),
    )
    .map((relation) => ({
      table: 'users',
      columns: relation.columns,
      condition: relation.columns[0],
    }));
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function publicTable(table) {
  return `public.${quoteIdentifier(table)}`;
}

function tenantCondition(alias) {
  const column = quoteIdentifier('tenant_id');
  return `${alias ? `${alias}.` : ''}${column} = current_setting('app.target_tenant_id')`;
}

function renderScopeCondition(definition) {
  return definition.scopeRelations
    .map((relation, index) => {
      const parentAlias = `parent_${index}`;
      const keyCondition = relation.columns
        .map(
          (column, columnIndex) =>
            `${parentAlias}.${quoteIdentifier(
              relation.parentColumns[columnIndex],
            )} = child.${quoteIdentifier(column)}`,
        )
        .join(' AND ');
      return `EXISTS (SELECT 1 FROM ${publicTable(
        relation.parentTable,
      )} AS ${parentAlias} WHERE ${keyCondition} AND ${tenantCondition(
        parentAlias,
      )})`;
    })
    .join('\n  AND ');
}

export function renderExportQuery(definition) {
  const exportTenantCondition = (alias) =>
    `${alias ? `${alias}.` : ''}${quoteIdentifier(
      'tenant_id',
    )} = :'target_tenant_id'`;

  if (definition.kind === 'tenant') {
    return `COPY (SELECT * FROM ${publicTable(
      definition.table,
    )} WHERE ${exportTenantCondition('')}) TO STDOUT WITH (FORMAT csv);`;
  }

  const scope = definition.scopeRelations
    .map((relation, index) => {
      const parentAlias = `parent_${index}`;
      const keyCondition = relation.columns
        .map(
          (column, columnIndex) =>
            `${parentAlias}.${quoteIdentifier(
              relation.parentColumns[columnIndex],
            )} = child.${quoteIdentifier(column)}`,
        )
        .join(' AND ');
      return `EXISTS (SELECT 1 FROM ${publicTable(
        relation.parentTable,
      )} AS ${parentAlias} WHERE ${keyCondition} AND ${exportTenantCondition(
        parentAlias,
      )})`;
    })
    .join('\n  AND ');

  return `COPY (SELECT child.* FROM ${publicTable(
    definition.table,
  )} AS child WHERE ${scope}) TO STDOUT WITH (FORMAT csv);`;
}

export function renderSchemaCheckSql(manifest) {
  const expectedRows = manifest.tables
    .map((table) => `  (${quoteLiteral(table)})`)
    .join(',\n');
  const allowedGlobalRows = manifest.prePurgeMutations
    .map((mutation) => `  (${quoteLiteral(mutation.table)})`)
    .join(',\n');

  return `-- GENERATED FILE. Run node tools/tenant-restore/generate-tenant-restore-sql.mjs
-- The expected table set is derived from apps/core-api/prisma/schema.prisma.
\\set ON_ERROR_STOP on

SELECT set_config('app.target_tenant_id', :'target_tenant_id', false);

DO $$
BEGIN
  IF current_setting('app.target_tenant_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'target_tenant_id must be a UUID';
  END IF;
END
$$;

BEGIN;

CREATE TEMP TABLE tenant_restore_expected_tables (
  table_name text PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO tenant_restore_expected_tables (table_name)
VALUES
${expectedRows};

CREATE TEMP TABLE tenant_restore_allowed_global_tables (
  table_name text PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO tenant_restore_allowed_global_tables (table_name)
VALUES
${allowedGlobalRows || '  (NULL)'};

DO $$
DECLARE
  unexpected text;
BEGIN
  SELECT string_agg(table_name, ', ' ORDER BY table_name)
  INTO unexpected
  FROM (
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'tenant_id'
      AND table_name <> 'tenants'
    EXCEPT
    SELECT table_name FROM tenant_restore_expected_tables
  ) missing_from_manifest;

  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'tenant_id tables missing from restore manifest: %', unexpected;
  END IF;

  SELECT string_agg(table_name, ', ' ORDER BY table_name)
  INTO unexpected
  FROM (
    SELECT table_name
    FROM tenant_restore_expected_tables expected
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.tables live
      WHERE live.table_schema = 'public'
        AND live.table_name = expected.table_name
    )
  ) missing_from_database;

  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'restore manifest tables missing from database: %', unexpected;
  END IF;

  SELECT string_agg(child_table, ', ' ORDER BY child_table)
  INTO unexpected
  FROM (
    SELECT DISTINCT tc.table_name AS child_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_schema = tc.constraint_schema
     AND ccu.constraint_name = tc.constraint_name
  WHERE tc.constraint_schema = 'public'
      AND tc.table_schema = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema = 'public'
      AND ccu.table_name IN (
        SELECT table_name FROM tenant_restore_expected_tables
      )
      AND tc.table_name NOT IN (
        SELECT table_name FROM tenant_restore_expected_tables
      )
      AND tc.table_name NOT IN (
        SELECT table_name FROM tenant_restore_allowed_global_tables
      )
  ) dependent_table_drift;

  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'tenant-dependent tables missing from restore manifest: %', unexpected;
  END IF;
END
$$;

COMMIT;
`;
}

export function renderPurgeSql(manifest) {
  const prePurge = manifest.prePurgeMutations
    .map(
      (mutation) => `UPDATE ${publicTable(mutation.table)}
SET ${quoteIdentifier(mutation.columns[0])} = NULL
WHERE ${quoteIdentifier(mutation.condition)} = current_setting('app.target_tenant_id');`,
    )
    .join('\n');
  const deletes = [...manifest.definitions]
    .reverse()
    .map((definition) => {
      const table = publicTable(definition.table);
      if (definition.kind === 'tenant') {
        return `DELETE FROM ${table}
WHERE ${tenantCondition('')};`;
      }
      return `DELETE FROM ${table} AS child
WHERE ${renderScopeCondition(definition)};`;
    })
    .join('\n');

  const selfStatements = manifest.selfReferences
    .map(
      (reference) => `UPDATE ${publicTable(reference.table)}
SET ${reference.columns
        .map((column) => `${quoteIdentifier(column)} = NULL`)
        .join(', ')}
WHERE ${quoteIdentifier('tenant_id')} = current_setting('app.target_tenant_id');`,
    )
    .join('\n');

  return `${renderSchemaCheckSql(manifest)}
BEGIN;

${prePurge}

${selfStatements}

${deletes}

COMMIT;
`;
}

export function buildTenantRestoreManifest(schema) {
  const models = parseModels(schema);
  const directModels = directTenantModels(models);
  const selectedModels = dependentModels(models, directModels);
  const relations = explicitRelations(models);
  const implicitJoins = implicitJoinDefinitions(models, selectedModels);
  const joinTables = new Set(implicitJoins.map((join) => join.table));
  const definitions = [...selectedModels].map((modelName) => {
    const model = models.find((candidate) => candidate.name === modelName);
    const modelRelations = relations.filter(
      (relation) =>
        relation.model === modelName &&
        selectedModels.has(relation.targetModel) &&
        relation.targetModel !== modelName,
    );

    return {
      table: model.table,
      kind: directModels.has(modelName) ? 'tenant' : 'dependent',
      dependencies: modelRelations.map((relation) => relation.targetTable),
      scopeRelations: directModels.has(modelName)
        ? []
        : modelRelations.map((relation) => ({
            columns: relation.columns,
            parentTable: relation.targetTable,
            parentColumns: relation.parentColumns,
          })),
    };
  });

  definitions.push(...implicitJoins);
  const orderedDefinitions = orderDefinitions(definitions);
  const modelByTable = new Map(models.map((model) => [model.table, model]));

  return {
    tables: orderedDefinitions.map((definition) => definition.table),
    definitions: orderedDefinitions,
    models: Object.fromEntries(
      orderedDefinitions.map((definition) => [
        definition.table,
        modelByTable.get(definition.table)?.name ?? null,
      ]),
    ),
    prePurgeMutations: prePurgeMutations(models),
    selfReferences: selfReferences(models, selectedModels),
  };
}

if (process.argv[1] === import.meta.filename) {
  const schemaPath = process.argv[2] ?? DEFAULT_SCHEMA_PATH;
  const schema = fs.readFileSync(schemaPath, 'utf8');
  process.stdout.write(`${JSON.stringify(buildTenantRestoreManifest(schema))}\n`);
}
