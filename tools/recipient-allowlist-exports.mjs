import ts from 'typescript'

function hasExportModifier(node) {
  return (
    Array.isArray(node.modifiers) &&
    node.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  )
}

function hasDefaultModifier(node) {
  return (
    Array.isArray(node.modifiers) &&
    node.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
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

function collectBindingElementList(elements, names) {
  for (const element of elements) {
    if (element.dotDotDotToken) return false
    if (!element.name || ts.isOmittedExpression(element.name)) return false
    if (!addBindingPattern(element.name, names)) return false
  }
  return true
}

function addBindingPattern(name, names) {
  if (ts.isIdentifier(name)) {
    names.add(name.text)
    return true
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return collectBindingElementList(name.elements, names)
  }
  return false
}

function collectExportVariableBindings(names, node) {
  if (!hasExportModifier(node)) return true
  for (const declaration of node.declarationList.declarations) {
    if (!addBindingPattern(declaration.name, names)) return false
  }
  return true
}

function collectNamedExport(names, node) {
  if (!hasExportModifier(node) && !hasDefaultModifier(node)) return
  names.add(node.name?.text ?? 'default')
}

function collectDeclarativeExport(statement, names) {
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    collectNamedExport(names, statement)
    return true
  }
  if (
    ts.isTypeAliasDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    collectNamedExport(names, statement)
    return true
  }
  return null
}

function collectModuleOrImportExport(statement, names) {
  if (ts.isModuleDeclaration(statement) && hasExportModifier(statement) && statement.name) {
    names.add(statement.name.text)
    return true
  }
  if (ts.isImportEqualsDeclaration(statement) && hasExportModifier(statement) && statement.name) {
    names.add(statement.name.text)
    return true
  }
  return null
}

function collectTopLevelExport(statement, names, sourceFile) {
  if (ts.isExportAssignment(statement)) {
    names.add('default')
    return true
  }
  if (ts.isExportDeclaration(statement)) {
    collectExportDeclaration(names, statement, sourceFile)
    return true
  }
  const declarative = collectDeclarativeExport(statement, names)
  if (declarative !== null) return declarative
  if (ts.isVariableStatement(statement)) {
    return collectExportVariableBindings(names, statement) ? true : null
  }
  const moduleOrImport = collectModuleOrImportExport(statement, names)
  if (moduleOrImport !== null) return moduleOrImport
  if (hasExportModifier(statement) || hasDefaultModifier(statement)) return null
  return true
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

  for (const statement of sourceFile.statements) {
    const outcome = collectTopLevelExport(statement, names, sourceFile)
    if (outcome === null) return null
  }

  return [...names].sort()
}
