import { describe, expect, it } from "vitest";
import {
  assertUrlAllowed,
  classifyAddress,
  isMetadataHostname,
  isPrivateAddress,
  parseIpLiteral,
  rewriteLocalhostForDocker,
  type Resolver,
} from "@/lib/fetch/ssrf";

const resolvesTo =
  (...addresses: string[]): Resolver =>
  async () =>
    addresses;

/** Resolver that must not be called (IP literals and metadata hostnames never hit DNS). */
const noDns: Resolver = async (host) => {
  throw new Error(`unexpected DNS lookup for ${host}`);
};

const METADATA_MESSAGE = /cloud metadata or link-local address\. MarkupLens never fetches these, even with ALLOW_PRIVATE_URLS=true\./;
const PRIVATE_MESSAGE = /private or local network address, which is blocked\. Set ALLOW_PRIVATE_URLS=true/;
const RESERVED_MESSAGE = /reserved or non-routable address/;

async function check(url: string, allowPrivateUrls: boolean, resolver: Resolver = noDns) {
  return assertUrlAllowed(new URL(url), { allowPrivateUrls, resolver });
}

describe("classifyAddress", () => {
  it.each([
    // IPv4 link-local / metadata
    "169.254.169.254",
    "169.254.0.1",
    "169.254.255.255",
    // IPv6 link-local and AWS IMDS IPv6
    "fe80::1",
    "febf::ffff",
    "fd00:ec2::254",
    // "this network" and unspecified
    "0.0.0.0",
    "0.1.2.3",
    "::",
    // IPv4-mapped forms of the above
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "::ffff:0.0.0.0",
    // Alibaba Cloud metadata (inside CGNAT) and its mapped form
    "100.100.100.200",
    "::ffff:100.100.100.200",
    // other non-public ranges the flag does not unlock
    "192.0.0.192",
    "224.0.0.1",
    "255.255.255.255",
    "64:ff9b::a9fe:a9fe",
    "2002:a9fe:a9fe::1",
    "not-an-ip",
  ])("%s is always blocked", (ip) => expect(classifyAddress(ip)).toBe("always-blocked"));

  it.each([
    "127.0.0.1",
    "127.10.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.10",
    "192.168.65.254", // host.docker.internal on Docker Desktop
    "100.64.0.1", // CGNAT / Tailscale
    "100.100.100.199",
    "100.127.255.255",
    "::ffff:100.64.0.1",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fd00:ec2::253", // next to the metadata address, still ULA
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
  ])("%s is private (allowed only with the flag)", (ip) => expect(classifyAddress(ip)).toBe("private"));

  it.each(["8.8.8.8", "93.184.215.14", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("%s is public", (ip) =>
    expect(classifyAddress(ip)).toBe("public"),
  );

  it("keeps isPrivateAddress as 'not public'", () => {
    expect(isPrivateAddress("10.0.0.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });
});

describe("parseIpLiteral (alternate IPv4 encodings)", () => {
  it.each([
    ["2852039166", "169.254.169.254"],
    ["0xA9FEA9FE", "169.254.169.254"],
    ["0xa9fea9fe", "169.254.169.254"],
    ["0251.0376.0251.0376", "169.254.169.254"],
    ["0xa9.254.0251.254", "169.254.169.254"],
    ["169.254.43518", "169.254.169.254"],
    ["169.16689662", "169.254.169.254"],
    ["0", "0.0.0.0"],
    ["127.1", "127.0.0.1"],
    ["[::ffff:a9fe:a9fe]", "::ffff:a9fe:a9fe"],
  ])("%s → %s", (input, expected) => expect(parseIpLiteral(input)?.toString()).toBe(expected));

  it("rejects hostnames and out-of-range numbers", () => {
    expect(parseIpLiteral("example.com")).toBeUndefined();
    expect(parseIpLiteral("1.2.3.256")).toBeUndefined();
    expect(parseIpLiteral("4294967296")).toBeUndefined();
    expect(parseIpLiteral("08.1.1.1")).toBeUndefined();
  });

  it("classifies the encoded forms as metadata", () => {
    for (const raw of ["2852039166", "0xA9FEA9FE", "0251.0376.0251.0376"]) expect(classifyAddress(raw)).toBe("always-blocked");
  });
});

describe("isMetadataHostname", () => {
  it.each(["metadata", "metadata.google.internal", "METADATA.Google.Internal.", "metadata.goog", "instance-data", "instance-data.ec2.internal", "x.metadata.google.internal"])(
    "%s is a metadata host",
    (h) => expect(isMetadataHostname(h)).toBe(true),
  );
  it.each(["example.com", "metadata.example.com", "mymetadata", "instance-data-viewer.com"])("%s is not", (h) =>
    expect(isMetadataHostname(h)).toBe(false),
  );
});

describe.each([
  { flag: false, label: "ALLOW_PRIVATE_URLS=false" },
  { flag: true, label: "ALLOW_PRIVATE_URLS=true" },
])("assertUrlAllowed with $label", ({ flag }) => {
  it("rejects non-http schemes", async () => {
    for (const url of ["ftp://example.com/", "file:///etc/passwd", "gopher://x/"]) {
      await expect(check(url, flag)).rejects.toThrow(/Only http and https/);
    }
  });

  it("allows public hosts", async () => {
    await expect(check("https://example.com/", flag, resolvesTo("93.184.215.14"))).resolves.toBeUndefined();
  });

  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "http://169.254.170.2/v2/credentials",
    "http://[fe80::1]/",
    "http://[fd00:ec2::254]/latest/meta-data/",
    "http://[::ffff:169.254.169.254]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://2852039166/",
    "http://0xA9FEA9FE/",
    "http://0251.0376.0251.0376/",
    "http://169.254.43518/",
    "http://100.100.100.200/latest/meta-data/",
    "http://[::ffff:100.100.100.200]/",
  ])("always blocks metadata/link-local %s", async (url) => {
    await expect(check(url, flag)).rejects.toThrow(METADATA_MESSAGE);
  });

  it.each(["http://0.0.0.0/", "http://0/", "http://[::]/", "http://[::ffff:0.0.0.0]/", "http://224.0.0.1/", "http://192.0.0.192/"])(
    "always blocks reserved %s",
    async (url) => {
      await expect(check(url, flag)).rejects.toThrow(RESERVED_MESSAGE);
    },
  );

  it.each(["http://metadata.google.internal/computeMetadata/v1/", "http://metadata/", "http://instance-data/latest/", "http://METADATA.GOOGLE.INTERNAL./"])(
    "always blocks metadata hostname %s without resolving it",
    async (url) => {
      await expect(check(url, flag)).rejects.toThrow(METADATA_MESSAGE);
    },
  );

  it("always blocks a public-looking hostname that resolves to the metadata address", async () => {
    await expect(check("http://innocent.example/", flag, resolvesTo("169.254.169.254"))).rejects.toThrow(METADATA_MESSAGE);
    await expect(check("http://innocent.example/", flag, resolvesTo("93.184.215.14", "::ffff:169.254.169.254"))).rejects.toThrow(METADATA_MESSAGE);
  });

  it.each([
    "http://127.0.0.1:8080/",
    "http://[::1]/",
    "http://10.0.0.5/",
    "http://172.20.1.1/",
    "http://192.168.1.20/",
    "http://[fd12::1]/",
    "http://100.64.0.1/",
    "http://100.101.102.103/",
    "http://[::ffff:100.64.0.1]/",
  ])(
    `${flag ? "allows" : "blocks"} private address %s`,
    async (url) => {
      const result = check(url, flag);
      if (flag) await expect(result).resolves.toBeUndefined();
      else await expect(result).rejects.toThrow(PRIVATE_MESSAGE);
    },
  );

  it(`${flag ? "allows" : "blocks"} localhost and host.docker.internal by their resolved addresses`, async () => {
    const localhost = check("http://localhost/dashboard/", flag, resolvesTo("::1", "127.0.0.1"));
    const dockerHost = check("http://host.docker.internal/", flag, resolvesTo("192.168.65.254"));
    if (flag) {
      await expect(localhost).resolves.toBeUndefined();
      await expect(dockerHost).resolves.toBeUndefined();
    } else {
      await expect(localhost).rejects.toThrow(PRIVATE_MESSAGE);
      await expect(dockerHost).rejects.toThrow(PRIVATE_MESSAGE);
    }
  });

  it(`${flag ? "allows" : "blocks"} a Tailscale (CGNAT) hostname`, async () => {
    const result = check("http://my-laptop.tail1234.ts.net/", flag, resolvesTo("100.88.12.34"));
    if (flag) await expect(result).resolves.toBeUndefined();
    else await expect(result).rejects.toThrow(PRIVATE_MESSAGE);
  });

  it("always blocks a hostname resolving to Alibaba Cloud metadata", async () => {
    await expect(check("http://innocent.example/", flag, resolvesTo("100.100.100.200"))).rejects.toThrow(METADATA_MESSAGE);
  });

  it("reports unresolvable hosts", async () => {
    await expect(
      check("http://nope.invalid/", flag, async () => {
        throw new Error("ENOTFOUND");
      }),
    ).rejects.toThrow(/Could not resolve/);
  });
});

describe("rewriteLocalhostForDocker", () => {
  it("rewrites loopback hosts only inside Docker", () => {
    expect(rewriteLocalhostForDocker(new URL("http://localhost/app/?q=1"), true).href).toBe("http://host.docker.internal/app/?q=1");
    expect(rewriteLocalhostForDocker(new URL("http://127.0.0.1:8080/"), true).href).toBe("http://host.docker.internal:8080/");
    expect(rewriteLocalhostForDocker(new URL("http://[::1]/"), true).hostname).toBe("host.docker.internal");
    expect(rewriteLocalhostForDocker(new URL("http://mysite.localhost/"), true).hostname).toBe("host.docker.internal");
    expect(rewriteLocalhostForDocker(new URL("http://localhost/"), false).href).toBe("http://localhost/");
    expect(rewriteLocalhostForDocker(new URL("https://example.com/"), true).href).toBe("https://example.com/");
  });

  it("does not rewrite 0.0.0.0 (it must stay blocked)", () => {
    expect(rewriteLocalhostForDocker(new URL("http://0.0.0.0/"), true).hostname).toBe("0.0.0.0");
  });
});
