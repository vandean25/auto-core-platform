import ts from 'typescript'

function hasExportModifier(node) {
  return (
    Array.isArray(node.modifiers) &&
    node.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  )
}

function namedBindingKey(exportName, propertyName) {
  if (!propertyName || propertyName === exportName) return exportName
  return `${propertyName}:${exportName}`
}

function collectExportDeclaration(names, node, sourceFile) {
  if (node.moduleSpecifier) {
    const specifier = node.moduleSpecifier.getText(sourceFile).replace(/^['"]|['"]$/g, '')
    names.add(`export*from:${specifier}`)
  }
  const clause = node.exportClause
  if (!clause) return
  if (ts.isNamedExports(clause)) {
    for (const element of clause.elements) {
      names.add(namedBindingKey(element.name.text, element.propertyName?.text))
    }
    return
  }
  if (ts.isNamespaceExport(clause)) names.add(`export*as:${clause.name.text}`)
}

function collectNamedExport(names, node) {
  if (!hasExportModifier(node) || !node.name) return
  names.add(node.name.text)
}

function collectExportVariableBindings(names, node) {
  if (!hasExportModifier(node)) return
  for (const declaration of node.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text)
  }
}

/** Collects exported surface names from `recipient-allowlist.ts` using the TypeScript AST. */
export function extractRecipientAllowlistExports(source) {
  const sourceFile = ts.createSourceFile(
    'recipient-allowlist.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const names = new Set()

  function visit(node) {
    if (ts.isExportAssignment(node)) {
      names.add('default')
    } else if (ts.isExportDeclaration(node)) {
      collectExportDeclaration(names, node, sourceFile)
    } else if (ts.isFunctionDeclaration(node)) {
      collectNamedExport(names, node)
    } else if (ts.isClassDeclaration(node)) {
      collectNamedExport(names, node)
    } else if (ts.isVariableStatement(node)) {
      collectExportVariableBindings(names, node)
    } else if (ts.isTypeAliasDeclaration(node)) {
      collectNamedExport(names, node)
    } else if (ts.isInterfaceDeclaration(node)) {
      collectNamedExport(names, node)
    } else if (ts.isEnumDeclaration(node)) {
      collectNamedExport(names, node)
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return [...names].sort()
}
