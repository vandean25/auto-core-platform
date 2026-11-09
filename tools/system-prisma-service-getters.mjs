import ts from 'typescript'

const TARGET_CLASS = 'SystemPrismaService'

function memberName(name) {
  if (ts.isIdentifier(name)) return name.text
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return null
}

function collectClassMemberNames(classDeclaration, names) {
  for (const member of classDeclaration.members) {
    if (ts.isConstructorDeclaration(member)) continue
    if (
      ts.isGetAccessor(member) ||
      ts.isSetAccessor(member) ||
      ts.isMethodDeclaration(member) ||
      ts.isPropertyDeclaration(member)
    ) {
      const label = memberName(member.name)
      if (label === null) return null
      names.add(label)
      continue
    }
    return null
  }
  return true
}

function findSystemPrismaClass(sourceFile) {
  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement) || !statement.name) continue
    if (statement.name.text === TARGET_CLASS) return statement
  }
  return null
}

/**
 * Collects every named surface on `SystemPrismaService` (accessors, methods, properties).
 * Returns null when the class or a member shape is not understood (fail closed).
 */
export function extractSystemPrismaGetters(source) {
  const sourceFile = ts.createSourceFile(
    'system-prisma.service.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const classDeclaration = findSystemPrismaClass(sourceFile)
  if (!classDeclaration) return null

  const names = new Set()
  if (!collectClassMemberNames(classDeclaration, names)) return null
  return [...names].sort()
}
