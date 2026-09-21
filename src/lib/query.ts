export async function firstRow<T>(rows: PromiseLike<T[]>): Promise<T | undefined> {
  return (await rows)[0];
}
