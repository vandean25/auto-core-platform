type ValidationRefreshHandle = () => void | Promise<void>

const handles = new Set<ValidationRefreshHandle>()

export function registerFormValidationRefresh(handle: ValidationRefreshHandle): () => void {
  handles.add(handle)
  return () => {
    handles.delete(handle)
  }
}

export async function refreshMountedFormValidations(): Promise<void> {
  await Promise.all([...handles].map((handle) => handle()))
}
