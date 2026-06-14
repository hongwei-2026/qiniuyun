let generationToken = 0

export function beginGeneration(): number {
  generationToken += 1
  return generationToken
}

export function cancelGeneration(): void {
  generationToken += 1
}

export function isGenerationCancelled(token: number): boolean {
  return token !== generationToken
}

export function throwIfCancelled(token: number): void {
  if (isGenerationCancelled(token)) {
    throw new Error('GENERATION_CANCELLED')
  }
}
