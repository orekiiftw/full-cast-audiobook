import { ProviderUnavailableError } from "../errors";
import { AcquiredBook, BookDetails, BookProvider, BookResult } from "../types";

const UNCONFIGURED_MESSAGE = "Anna's Archive adapter is not configured.";

export class AnnaArchiveProvider implements BookProvider {
  readonly name = "anna-archive";

  async search(): Promise<BookResult[]> {
    throw new ProviderUnavailableError(UNCONFIGURED_MESSAGE, this.name);
  }

  async getBook(): Promise<BookDetails> {
    throw new ProviderUnavailableError(UNCONFIGURED_MESSAGE, this.name);
  }

  async acquire(): Promise<AcquiredBook> {
    throw new ProviderUnavailableError(UNCONFIGURED_MESSAGE, this.name);
  }
}
