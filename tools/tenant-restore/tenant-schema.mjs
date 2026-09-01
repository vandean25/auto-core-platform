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

function normalizeReferentialAction(action) {
  if (!action) return undefined;
  const normalized = action.toUpperCase().replaceAll('_', ' ');
  return {
    SETNULL: 'SET NULL',
    SETDEFAULT: 'SET DEFAULT',
  }[normalized.replaceAll(' ', '')] ?? normalized;
}

function parseModels(schema) {
  const models = [];
  const modelPattern = /^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm;

  for (const match of withoutComments(schema).matchAll(modelPattern)) {
    const [, name, body] = match;
    const fields = new Map();
    const relations = [];
    let keyFields = [];
    let table = name;

    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;

      const mapMatch = line.match(/^@@map\("([^"]+)"\)/);
      if (mapMatch) {
        table = mapMatch[1];
        continue;
      }

      const idMatch = line.match(/^@@id\(\[([^\]]+)\]/);
      if (idMatch) {
        keyFields = parseList(idMatch[1]);
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
        primaryKey: attributes.includes('@id'),
      });

      const relationMatch = attributes.match(/@relation\((.*)\)/);
      if (!relationMatch) continue;

      const relationArgs = relationMatch[1];
      const quotedName = relationArgs.match(/^"([^"]+)"/)?.[1];
      const fieldsMatch = relationArgs.match(/fields:\s*\[([^\]]+)\]/);
      const referencesMatch = relationArgs.match(
        /references:\s*\[([^\]]+)\]/,
      );
      const onDelete = relationArgs.match(/onDelete:\s*(\w+)/)?.[1];
      const onUpdate = relationArgs.match(/onUpdate:\s*(\w+)/)?.[1];

      relations.push({
        field,
        targetModel: type,
        relationName: quotedName,
        fields: fieldsMatch ? parseList(fieldsMatch[1]) : [],
        references: referencesMatch ? parseList(referencesMatch[1]) : [],
        onDelete: normalizeReferentialAction(onDelete),
        onUpdate: normalizeReferentialAction(onUpdate),
      });
    }

    if (keyFields.length === 0) {
      keyFields = [...fields.entries()]
        .filter(([, field]) => field.primaryKey)
        .map(([field]) => field);
    }

    models.push({ name, table, fields, relations, keyFields });
  }

  return models;
}

function tableForModel(models, modelName) {
  return models.find((model) => model.name === modelName)?.table;
}

function dbFields(model, fieldNames) {
  return fieldNames.map(
    (fieldName) => model?.fields.get(fieldName)?.dbField ?? fieldName,
  );
}

function explicitRelations(models) {
  return models.flatMap((model) =>
    model.relations
      .filter((relation) => relation.fields.length > 0)
      .map((relation) => {
        const targetModel = models.find(
          (candidate) => candidate.name === relation.targetModel,
        );
        const nonTenantFields = relation.fields.filter(
          (field) => model.fields.get(field)?.dbField !== 'tenant_id',
        );
        const optionalRelation =
          nonTenantFields.length > 0 &&
          nonTenantFields.every((field) => model.fields.get(field)?.nullable);
        return {
          ...relation,
          model: model.name,
          table: model.table,
          targetTable: targetModel?.table,
          columns: dbFields(model, relation.fields),
          parentColumns: dbFields(targetModel, relation.references),
          onDelete:
            relation.onDelete ?? (optionalRelation ? 'SET NULL' : 'RESTRICT'),
          onUpdate: relation.onUpdate ?? 'CASCADE',
        };
      }),
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
      const linkFields = relation.fields.filter(
        (field) => model.fields.get(field)?.dbField !== 'tenant_id',
      );
      const columns = dbFields(model, linkFields);
      // Tenant restore copies rows with the self-link stripped (NULLed), then
      // re-links them from a staging table. Only NULLABLE link columns can be
      // stripped; non-nullable grouping columns of a composite self-FK (e.g.
      // storage_locations.site_id) are carried through as-is and are NOT part
      // of the link/nullation set. A self-reference with no nullable column is
      // un-restorable.
      const linkColumns = dbFields(
        model,
        linkFields.filter((field) => model.fields.get(field)?.nullable),
      );

      if (linkColumns.length === 0) {
        throw new Error(
          `Self-reference on ${model.table} must use nullable columns: ${columns.join(', ')}`,
        );
      }

      return {
        table: model.table,
        columns: linkColumns,
        keyColumns: dbFields(model, model.keyFields),
        nullable: true,
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

function foreignKeySignatures(
  relations,
  implicitJoins,
  migrationActions = new Map(),
) {
  return foreignKeySignaturesWithActions(
    relations,
    implicitJoins,
    migrationActions,
  );
}

function foreignKeyKey(childTable, parentTable, childColumns, parentColumns) {
  return [
    childTable,
    parentTable,
    childColumns.join(','),
    parentColumns.join(','),
  ].join('|');
}

export function parseMigrationForeignKeyActions(migrationSql) {
  const actions = new Map();
  const foreignKeyPattern =
    /ALTER TABLE\s+"([^"]+)"\s+ADD CONSTRAINT\s+"[^"]+"\s+FOREIGN KEY\s+\(([^)]+)\)\s+REFERENCES\s+"([^"]+)"\s*\(([^)]+)\)(?:\s+ON DELETE\s+(NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT))?(?:\s+ON UPDATE\s+(NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT))?\s*;/g;

  for (const match of migrationSql.matchAll(foreignKeyPattern)) {
    const [
      ,
      childTable,
      childColumns,
      parentTable,
      parentColumns,
      onDelete = 'NO ACTION',
      onUpdate = 'NO ACTION',
    ] = match;
    const normalizeColumns = (columns) =>
      columns.split(',').map((column) => column.trim().replaceAll('"', ''));
    actions.set(
      foreignKeyKey(
        childTable,
        parentTable,
        normalizeColumns(childColumns),
        normalizeColumns(parentColumns),
      ),
      {
        onDelete,
        onUpdate,
      },
    );
  }

  return actions;
}

function foreignKeySignaturesWithActions(
  relations,
  implicitJoins,
  migrationActions = new Map(),
) {
  const explicit = relations
    .filter((relation) => relation.targetTable)
    .map((relation) => {
      const action = migrationActions.get(
        foreignKeyKey(
          relation.table,
          relation.targetTable,
          relation.columns,
          relation.parentColumns,
        ),
      );
      return {
        childTable: relation.table,
        parentTable: relation.targetTable,
        childColumns: relation.columns,
        parentColumns: relation.parentColumns,
        onDelete: action?.onDelete ?? relation.onDelete,
        onUpdate: action?.onUpdate ?? relation.onUpdate,
      };
    });
  const implicit = implicitJoins.flatMap((join) =>
    join.scopeRelations.map((relation) => {
      const action = migrationActions.get(
        foreignKeyKey(
          join.table,
          relation.parentTable,
          relation.columns,
          relation.parentColumns,
        ),
      );
      return {
        childTable: join.table,
        parentTable: relation.parentTable,
        childColumns: relation.columns,
        parentColumns: relation.parentColumns,
        onDelete: action?.onDelete ?? 'CASCADE',
        onUpdate: action?.onUpdate ?? 'CASCADE',
      };
    }),
  );

  return [...explicit, ...implicit].sort((left, right) =>
    [
      left.childTable,
      left.parentTable,
      left.childColumns.join(','),
      left.parentColumns.join(','),
    ]
      .join('|')
      .localeCompare(
        [
          right.childTable,
          right.parentTable,
          right.childColumns.join(','),
          right.parentColumns.join(','),
        ].join('|'),
      ),
  );
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

export function renderExportQuery(
  definition,
  { columns = null, nullColumns = [] } = {},
) {
  const exportTenantCondition = (alias) =>
    `${alias ? `${alias}.` : ''}${quoteIdentifier(
      'tenant_id',
    )} = :'target_tenant_id'`;
  const projection = columns
    ? columns
        .map((column) =>
          nullColumns.includes(column)
            ? `NULL AS ${quoteIdentifier(column)}`
            : quoteIdentifier(column),
        )
        .join(', ')
    : '*';

  if (definition.kind === 'tenant') {
    return `COPY (SELECT ${projection} FROM ${publicTable(
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

  return `COPY (SELECT ${
    columns
      ? columns
          .map((column) =>
            nullColumns.includes(column)
              ? `NULL AS ${quoteIdentifier(column)}`
              : `child.${quoteIdentifier(column)}`,
          )
          .join(', ')
      : 'child.*'
  } FROM ${publicTable(
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
  const expectedForeignKeyRows = manifest.foreignKeys
    .map(
      (foreignKey) =>
        `  (${[
          foreignKey.childTable,
          foreignKey.parentTable,
          foreignKey.childColumns.join(','),
          foreignKey.parentColumns.join(','),
          foreignKey.onDelete,
          foreignKey.onUpdate,
        ]
          .map(quoteLiteral)
          .join(', ')})`,
    )
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

CREATE TEMP TABLE tenant_restore_expected_foreign_keys (
  child_table text NOT NULL,
  parent_table text NOT NULL,
  child_columns text NOT NULL,
  parent_columns text NOT NULL,
  on_delete text NOT NULL,
  on_update text NOT NULL,
  PRIMARY KEY (
    child_table,
    parent_table,
    child_columns,
    parent_columns
  )
) ON COMMIT DROP;

INSERT INTO tenant_restore_expected_foreign_keys (
  child_table,
  parent_table,
  child_columns,
  parent_columns,
  on_delete,
  on_update
)
VALUES
${expectedForeignKeyRows};

CREATE TEMP TABLE tenant_restore_live_foreign_keys (
  child_table text NOT NULL,
  parent_table text NOT NULL,
  child_columns text NOT NULL,
  parent_columns text NOT NULL,
  on_delete text NOT NULL,
  on_update text NOT NULL,
  PRIMARY KEY (
    child_table,
    parent_table,
    child_columns,
    parent_columns
  )
) ON COMMIT DROP;

INSERT INTO tenant_restore_live_foreign_keys (
  child_table,
  parent_table,
  child_columns,
  parent_columns,
  on_delete,
  on_update
)
SELECT
  child.relname,
  parent.relname,
  string_agg(child_column.attname, ',' ORDER BY child_key.ordinality),
  string_agg(parent_column.attname, ',' ORDER BY parent_key.ordinality),
  CASE constraint_row.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
  END,
  CASE constraint_row.confupdtype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
  END
FROM pg_constraint constraint_row
JOIN pg_class child ON child.oid = constraint_row.conrelid
JOIN pg_namespace child_schema ON child_schema.oid = child.relnamespace
JOIN pg_class parent ON parent.oid = constraint_row.confrelid
JOIN pg_namespace parent_schema ON parent_schema.oid = parent.relnamespace
CROSS JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS child_key(attnum, ordinality)
CROSS JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY AS parent_key(attnum, ordinality)
JOIN pg_attribute child_column
  ON child_column.attrelid = child.oid
 AND child_column.attnum = child_key.attnum
JOIN pg_attribute parent_column
  ON parent_column.attrelid = parent.oid
 AND parent_column.attnum = parent_key.attnum
WHERE constraint_row.contype = 'f'
  AND child_schema.nspname = 'public'
  AND parent_schema.nspname = 'public'
  AND child_key.ordinality = parent_key.ordinality
GROUP BY
  constraint_row.oid,
  child.relname,
  parent.relname,
  constraint_row.confdeltype,
  constraint_row.confupdtype;

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

  SELECT string_agg(
    format(
      '%s(%s)->%s(%s) %s/%s',
      child_table,
      child_columns,
      parent_table,
      parent_columns,
      on_delete,
      on_update
    ),
    '; ' ORDER BY child_table, parent_table, child_columns
  )
  INTO unexpected
  FROM (
    SELECT * FROM tenant_restore_expected_foreign_keys
    EXCEPT
    SELECT * FROM tenant_restore_live_foreign_keys
    UNION
    SELECT * FROM tenant_restore_live_foreign_keys
    EXCEPT
    SELECT * FROM tenant_restore_expected_foreign_keys
  ) foreign_key_drift;

  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'foreign-key signatures differ from restore manifest: %', unexpected;
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

\\if :{?tenant_restore_in_transaction}
\\else
COMMIT;
\\endif
`;
}

export function buildTenantRestoreManifest(
  schema,
  migrationActions = new Map(),
) {
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
    foreignKeys: foreignKeySignatures(
      relations,
      implicitJoins,
      migrationActions,
    ),
  };
}

export function buildTenantRestoreManifestFromFiles(
  schemaPath,
  migrationsDirectory,
) {
  const migrationSql = fs
    .readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) =>
      fs.readFileSync(
        path.join(migrationsDirectory, entry.name, 'migration.sql'),
        'utf8',
      ),
    )
    .join('\n');

  return buildTenantRestoreManifest(
    fs.readFileSync(schemaPath, 'utf8'),
    parseMigrationForeignKeyActions(migrationSql),
  );
}

if (process.argv[1] === import.meta.filename) {
  const schemaPath = process.argv[2] ?? DEFAULT_SCHEMA_PATH;
  const schema = fs.readFileSync(schemaPath, 'utf8');
  process.stdout.write(`${JSON.stringify(buildTenantRestoreManifest(schema))}\n`);
}
