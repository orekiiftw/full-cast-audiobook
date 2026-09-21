import { describe, expect, it, mock } from "bun:test";
import { LibgenProvider } from "./libgen";

describe("LibgenProvider", () => {
  const searchHtml = `
    <table><tbody>
    <tr valign="top">
      <td><a href="edition.php?id=1">Godan: A Novel of Peasant India <i>22. Jaico impr</i></a></td>
      <td>Premchand, </td>
      <td>Jaico Publ. House</td>
      <td><nobr>2013;2008</nobr></td>
      <td>Hindi</td>
      <td>0</td>
      <td><nobr><a href="/file.php?id=1">710 kB</a></nobr></td>
      <td>epub</td>
      <td><a href="/ads.php?md5=5cd226ba3a3b1e02cdcd58ef2618d6d1">1</a></td>
    </tr>
    <tr valign="top">
      <td><a href="edition.php?id=2">A PDF Only Book</a></td>
      <td>Someone</td>
      <td>Pub</td>
      <td>2001</td>
      <td>English</td>
      <td>0</td>
      <td><nobr><a href="/file.php?id=2">2 MB</a></nobr></td>
      <td>pdf</td>
      <td><a href="/ads.php?md5=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">1</a></td>
    </tr>
    </tbody></table>`;

  it("parses EPUB rows and skips non-EPUB formats", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response(searchHtml, { status: 200 })) as unknown as typeof fetch;
    try {
      const results = await new LibgenProvider().search({ title: "Godan" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("5cd226ba3a3b1e02cdcd58ef2618d6d1");
      expect(results[0].title).toBe("Godan: A Novel of Peasant India");
      expect(results[0].language).toBe("Hindi");
      expect(results[0].format).toBe("epub");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("surfaces an error page instead of treating it as a file", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("ads.php")) {
        return new Response('<a href="get.php?md5=5cd226ba3a3b1e02cdcd58ef2618d6d1&key=ABC123">dl</a>', { status: 200 });
      }
      return new Response('<div class="alert">3306. max_user_connections</div>', {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    }) as unknown as typeof fetch;
    try {
      await expect(
        new LibgenProvider().acquire({
          id: "5cd226ba3a3b1e02cdcd58ef2618d6d1",
          provider: "libgen",
          title: "Godan",
          authors: [],
          format: "epub",
          mirrors: [{ id: "x", label: "LibGen", kind: "direct", url: "https://libgen.li/ads.php?md5=5cd226ba3a3b1e02cdcd58ef2618d6d1" }],
        }),
      ).rejects.toThrow("served an error page");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
