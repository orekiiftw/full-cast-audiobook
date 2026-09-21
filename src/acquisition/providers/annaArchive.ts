import { ProviderUnavailableError } from "../errors";
import { AcquiredBook, BookDetails, BookProvider, BookResult, SearchQuery } from "../types";

const UNCONFIGURED_MESSAGE = "Anna's Archive adapter is not configured.";

export class AnnaArchiveProvider implements BookProvider {
  readonly name = "anna-archive";

  async search(_query: SearchQuery): Promise<BookResult[]> {
    throw new ProviderUnavailableError(UNCONFIGURED_MESSAGE, this.name);
  }

  async getBook(_id: string): Promise<BookDetails> {
    throw new ProviderUnavailableError(UNCONFIGURED_MESSAGE, this.name);
  }

  async acquire(_book: BookResult): Promise<AcquiredBook> {
    throw new ProviderUnavailableError(UNCONFIGURED_MESSAGE, this.name);
  }
}
