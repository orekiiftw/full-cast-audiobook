import { ApiError } from "@/api/client";
import { describeAddFailure, describeSearchFailure, formatFormat, formatSize, partialNotice, providerLabel } from "@/lib/searchFeedback";

// Three failures that used to collapse into one "Search failed" string: the request timed out,
// the server was never reached, and the server answered with an error. Each keeps its own copy.

describe("search failures", () => {
  it("names a timeout as a timeout", () => {
    const failure = describeSearchFailure(new ApiError(0, "Search is taking too long — try again.", { timedOut: true }));
    expect(failure.kind).toBe("timeout");
    expect(failure.title).toBe("Search timed out");
    expect(failure.detail).toContain("cached");
  });

  it("names an unreachable server and keeps the address it names", () => {
    const failure = describeSearchFailure(new ApiError(0, "Can't reach the server at http://10.0.2.2:3000."));
    expect(failure.kind).toBe("offline");
    expect(failure.title).toBe("Can't reach the server");
    expect(failure.detail).toContain("http://10.0.2.2:3000");
  });

  it("passes a server refusal through verbatim", () => {
    const failure = describeSearchFailure(new ApiError(500, "Provider registry is unavailable."));
    expect(failure.kind).toBe("server");
    expect(failure.title).toBe("The search failed");
    expect(failure.detail).toBe("Provider registry is unavailable.");
  });

  it("separates rate limiting and an expired session from a server error", () => {
    expect(describeSearchFailure(new ApiError(429, "Too many book searches. Try again later.")).kind).toBe("rate-limited");
    expect(describeSearchFailure(new ApiError(401, "Authentication required")).kind).toBe("session");
  });

  it("falls back without throwing on an unknown error", () => {
    const failure = describeSearchFailure(new Error("boom"));
    expect(failure.kind).toBe("unknown");
    expect(failure.detail).toBe("boom");
    expect(describeSearchFailure(undefined).detail).toContain("Try again");
  });

  it("keeps the timeout and offline titles for an add, but its own title for a refusal", () => {
    expect(describeAddFailure(new ApiError(0, "t", { timedOut: true })).title).toBe("The add timed out");
    expect(describeAddFailure(new ApiError(0, "Can't reach")).title).toBe("Can't reach the server");
    expect(describeAddFailure(new ApiError(400, "Duplicate book")).title).toBe("Could not add this book");
    expect(describeAddFailure(new ApiError(400, "Duplicate book")).detail).toBe("Duplicate book");
  });
});

describe("partial search marker", () => {
  it("names the sources still working, in the reducer's own words", () => {
    const notice = partialNotice(["archive-org"]);
    expect(notice.title).toBe("Some sources are still searching");
    expect(notice.detail).toContain("Internet Archive");
    expect(notice.detail).toContain("hasn't answered");
  });

  it("reads naturally for two or three pending providers", () => {
    expect(partialNotice(["archive-org", "gutenberg"]).detail).toContain("Internet Archive and Project Gutenberg haven't answered");
    expect(partialNotice(["archive-org", "gutenberg", "libgen"]).detail).toContain(
      "Internet Archive, Project Gutenberg and LibGen haven't answered",
    );
  });

  it("still explains a partial answer that names nobody", () => {
    const notice = partialNotice([]);
    expect(notice.detail).toContain("later search");
  });

  it("labels providers it knows and title-cases the ones it does not", () => {
    expect(providerLabel("anna-archive")).toBe("Anna's Archive");
    expect(providerLabel("some_new_source")).toBe("Some New Source");
  });
});

describe("result formatting", () => {
  it("renders sizes and formats the way the row shows them", () => {
    expect(formatSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
    expect(formatSize(900 * 1024)).toBe("900 KB");
    expect(formatSize(undefined)).toBeNull();
    expect(formatFormat("epub")).toBe("EPUB");
    expect(formatFormat("")).toBe("UNKNOWN");
  });
});
