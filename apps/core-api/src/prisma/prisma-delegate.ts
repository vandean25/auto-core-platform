export function toPrismaDelegateKey(modelName: string): string {
  if (!modelName) {
    return modelName;
  }

  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}