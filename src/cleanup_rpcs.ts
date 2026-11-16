import fs from "fs";
import { getAllJsonFiles } from "./utils/fs";
import { fetchChainListOrgRpcs } from "./utils/chainlist";
import { Network } from "./types/registry";

// RPC cleanup / audit tool.
//
// For every EVM (eip155) network it probes the registry's RPC endpoints, and if fewer than
// --max are healthy, public candidates from chainlist.org, for:
//   - correct chainId (eth_chainId matches caip2Id)
//   - serving firstStreamableBlock with the right hash (the same check validate_urls does)
//   - archive capability (historical state query at firstStreamableBlock.height succeeds)
// Healthy = the first two. It then:
//   - keeps healthy registry endpoints (archive or not) and ALL Pinax endpoints
//   - removes registry endpoints that are dead or fail the check
//   - tops up to --max with healthy chainlist.org endpoints: archive first, then least
//     tracking, one per provider host
// If nothing at all is healthy (e.g. no node serves block 0, or firstStreamableBlock is
// stale), endpoints that are up on the right chain are kept and the chain is reported.
//
// Usage:
//   bun run src/cleanup_rpcs.ts [--write] [--max=3] [<idOrPrefix> ...]
//     --write        apply changes to the registry JSONs (default: dry run / report only)
//     --max=N        target number of RPCs per chain (default 3)
//     <idOrPrefix>   only process chains whose id equals or starts with the argument(s)
//
// After --write, run `bun format` to normalise the JSON.

const REGISTRY_DIR = "registry";
const TIMEOUT_MS = 8000;
const DEAD_ADDR = "0x000000000000000000000000000000000000dEaD";
const CONCURRENCY = 12;

// endpoints that embed an API key/token — not stable public endpoints
// (incl. UUID keys, e.g. dwellir, and personal QuickNode subdomains)
const DEMO_KEY =
  /docs-demo|dkey=|[?&]token=|\/v1\/[0-9a-f]{20,}|\/rpc\/[0-9a-f]{20,}|\/[0-9a-f]{32,}(\/|$)|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\.quiknode\.pro/i;
const isUsablePublic = (u: string) =>
  !!u &&
  !u.includes("${") &&
  !u.includes("API_KEY") &&
  !u.startsWith("ws") &&
  !DEMO_KEY.test(u);
// registry endpoints we can probe as-is (not templated with a key placeholder)
const isProbeable = (u: string) =>
  !!u && u.startsWith("http") && !u.includes("{") && !u.includes("API_KEY");
const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();
const host = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};
const eqHash = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
// Pinax first-party endpoints are always preserved (never dropped by cleanup), even if
// they are temporarily down / not archive — those are reported as issues instead.
// Current form is `<id>.rpc.pinax.network`; the legacy `<id>.rpc.service.pinax.network` is also matched.
const isPinax = (u: string) => /\.rpc(\.service)?\.pinax\.network/.test(u);

type Probe = {
  url: string;
  reachable: boolean;
  chainId?: number;
  blockHash?: string | null;
  blockErr?: string | null;
  archive?: boolean;
  err?: string;
  archiveErr?: string | null;
};

// Errors that say "not right now" rather than "this endpoint is broken": rate limits and
// per-IP quotas (1rpc, OnFinality, Pinax free tier), timeouts and 5xx. A registry endpoint
// failing only with these is kept (and reported) — a single probe from one IP isn't
// enough evidence to delete it. DNS failures, wrong chain, missing methods, paid-plan
// 4xx and missing/mismatched blocks are definitive and get the endpoint removed.
const TRANSIENT =
  /HTTP (408|425|429|5\d\d)|timeout|timed out|rate.?limit|usage limit|too many requests|temporar|try again|retry|service unavailable/i;

async function rpcOnce(url: string, method: string, params: unknown[]) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "User-Agent": "Mozilla/5.0 (networks-registry rpc-cleanup)",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctl.signal,
    });
    if (!r.ok) return { err: `HTTP ${r.status}`, transient: r.status >= 500 };
    const j = (await r.json()) as any;
    if (j.error) return { err: j.error.message || JSON.stringify(j.error) };
    return { ok: j.result };
  } catch (e: any) {
    return { err: e.name === "AbortError" ? "timeout" : e.message, transient: true };
  } finally {
    clearTimeout(t);
  }
}

async function rpc(url: string, method: string, params: unknown[]) {
  let r = await rpcOnce(url, method, params);
  if (r.err && (r as any).transient) r = await rpcOnce(url, method, params);
  return r;
}

async function probe(url: string, height: number): Promise<Probe> {
  const cid = await rpc(url, "eth_chainId", []);
  if (cid.err) return { url, reachable: false, err: cid.err };
  const chainId = parseInt(cid.ok as string, 16);
  const hx = "0x" + height.toString(16);
  const blk = await rpc(url, "eth_getBlockByNumber", [hx, false]);
  const blockHash = (blk.ok as any)?.hash ?? null;
  const bal = await rpc(url, "eth_getBalance", [DEAD_ADDR, hx]);
  return {
    url,
    reachable: true,
    chainId,
    blockHash,
    blockErr: blk.err ?? null,
    archive: bal.ok !== undefined,
    archiveErr: bal.err ?? null,
  };
}

async function pool<T, S>(items: T[], fn: (i: T) => Promise<S>): Promise<S[]> {
  const out: S[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker),
  );
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const max = parseInt(
    args.find((a) => a.startsWith("--max="))?.split("=")[1] ?? "3",
    10,
  );
  const filters = args.filter((a) => !a.startsWith("--"));

  const chainlist = await fetchChainListOrgRpcs();
  const clById = new Map(chainlist.map((c) => [c.chainId, c]));
  const trackingOf = (cid: number, url: string) =>
    clById.get(cid)?.rpc?.find((x: any) => x.url === url)?.tracking as
      | string
      | undefined;
  const trackRank: Record<string, number> = {
    none: 0,
    limited: 1,
    undefined: 2,
    yes: 3,
  };

  const files = getAllJsonFiles(REGISTRY_DIR).filter((f) =>
    f.includes("/eip155/"),
  );
  const issues: string[] = [];
  let changed = 0;

  for (const file of files) {
    const net = JSON.parse(fs.readFileSync(file, "utf-8")) as Network;
    if (filters.length && !filters.some((f) => net.id === f || net.id.startsWith(f)))
      continue;

    const expected = parseInt(net.caip2Id.split(":")[1], 10);
    const fsb = net.firehose?.firstStreamableBlock;
    const height = fsb?.height ?? 0;
    const fsbId = fsb?.id;
    const current = net.rpcUrls ?? [];

    // 1. probe what is in the registry now (incl. keyed endpoints someone added on purpose)
    const curResults = await pool(current.filter(isProbeable), (u) => probe(u, height));
    const byUrl = new Map(curResults.map((r) => [r.url, r]));
    // healthy = what validate_urls checks: right chain, serves firstStreamableBlock
    const healthy = (u: string) => {
      const r = byUrl.get(u);
      return (
        !!r &&
        r.reachable &&
        r.chainId === expected &&
        (fsbId ? eqHash(r.blockHash, fsbId) : true)
      );
    };
    const reachable = (u: string) => {
      const r = byUrl.get(u);
      return !!r && r.reachable && r.chainId === expected;
    };
    // failing only with a transient error (rate limit / quota / timeout / 5xx)
    const flakyErr = (u: string) => {
      const r = byUrl.get(u);
      if (!r || healthy(u)) return null;
      const e = r.reachable ? r.blockErr : r.err;
      return e && TRANSIENT.test(e) ? e : null;
    };
    for (const u of current)
      if (!isPinax(u) && flakyErr(u))
        issues.push(`${net.id}: ${u} failed transiently (${flakyErr(u)}) — kept, re-check`);
    // keep Pinax, healthy and flaky current endpoints, and anything we can't probe;
    // drop the rest (dead / wrong chain / doesn't serve firstStreamableBlock)
    const kept = current.filter(
      (u) => isPinax(u) || !isProbeable(u) || healthy(u) || !!flakyErr(u),
    );

    // 2. top up to --max from chainlist.org (archive first, then least tracking)
    let clResults: Probe[] = [];
    const added: string[] = [];
    if (kept.length < max) {
      const seen = new Set(current.map(norm));
      const clRpcs = [
        ...new Map(
          (clById.get(expected)?.rpc ?? [])
            .map((r) => r.url)
            .filter((u) => isUsablePublic(u) && !isPinax(u) && !seen.has(norm(u)))
            .map((u) => [norm(u), u] as const),
        ).values(),
      ];
      clResults = await pool(clRpcs, (u) => probe(u, height));
      for (const r of clResults) byUrl.set(r.url, r);
      const hosts = new Set(kept.map(host));
      const ranked = clResults
        .filter((r) => healthy(r.url))
        .sort((a, b) => {
          if (!!a.archive !== !!b.archive) return a.archive ? -1 : 1;
          const ta = trackRank[String(trackingOf(expected, a.url))];
          const tb = trackRank[String(trackingOf(expected, b.url))];
          return ta !== tb ? ta - tb : a.url.length - b.url.length;
        });
      for (const r of ranked) {
        if (kept.length + added.length >= max) break;
        if (hosts.has(host(r.url))) continue; // one endpoint per provider host
        hosts.add(host(r.url));
        added.push(r.url);
      }
    }
    const results = [...curResults, ...clResults];

    // --- issue detection ---
    // chainId mismatch on official/current endpoints
    for (const u of current) {
      const r = byUrl.get(u);
      if (r?.reachable && r.chainId !== expected && !u.includes("pinax"))
        issues.push(
          `${net.id}: ${u} reports chainId ${r.chainId}, registry says ${expected}`,
        );
    }
    // firstStreamableBlock verification (only meaningful when we can read that block)
    const correct = results.filter(
      (r) => r.reachable && r.chainId === expected && r.blockHash,
    );
    const agree = correct.filter((r) => eqHash(r.blockHash, fsbId));
    const disagree = correct.filter((r) => !eqHash(r.blockHash, fsbId));
    if (fsbId && disagree.length && agree.length === 0)
      issues.push(
        `${net.id}: firstStreamableBlock STALE — registry ${fsbId} but all live nodes report ${disagree[0].blockHash} at height ${height}`,
      );
    else if (fsbId && disagree.length && agree.length)
      issues.push(
        `${net.id}: firstStreamableBlock INCONSISTENT — some nodes match registry, others report ${disagree[0].blockHash} (possible reset / mixed backends)`,
      );
    // broken Pinax first-party endpoints
    for (const r of results) {
      if (!isPinax(r.url)) continue;
      if (!r.reachable) issues.push(`${net.id}: Pinax ${r.url} DOWN (${r.err})`);
      else if (r.chainId !== expected)
        issues.push(`${net.id}: Pinax ${r.url} wrong chainId ${r.chainId}`);
      else if (!r.archive)
        issues.push(`${net.id}: Pinax ${r.url} NOT archive (${r.archiveErr})`);
    }

    // --- selection ---
    let chosen = [...kept, ...added];
    const healthyCount = chosen.filter(healthy).length;
    if (healthyCount === 0) {
      // Nothing serves firstStreamableBlock (not served by any node, or registry value
      // is stale): keep endpoints that are up on the right chain rather than emptying
      // the list. Only endpoints that are down / wrong chain get removed.
      const up = current.filter((u) => !isPinax(u) && reachable(u));
      chosen = current.filter(
        (u) => isPinax(u) || !isProbeable(u) || up.includes(u) || !!flakyErr(u),
      );
      if (up.length)
        issues.push(
          `${net.id}: no RPC serves firstStreamableBlock — kept ${up.length} reachable RPC(s)`,
        );
      else if (current.some((u) => !isPinax(u) && isProbeable(u) && !flakyErr(u)))
        issues.push(`${net.id}: all public RPCs dead — removed`);
      else if (!chosen.length) issues.push(`${net.id}: no RPC endpoints and none available`);
    } else if (healthyCount < max) {
      issues.push(`${net.id}: only ${healthyCount}/${max} healthy RPC(s) available`);
    }

    if (JSON.stringify(chosen) === JSON.stringify(current)) continue;
    changed++;
    console.log(`${write ? "UPDATE" : "would update"} ${net.id}:`);
    for (const u of current) if (!chosen.includes(u)) console.log(`   - ${u}`);
    for (const u of chosen) if (!current.includes(u)) console.log(`   + ${u}`);
    if (write) {
      net.rpcUrls = chosen;
      fs.writeFileSync(file, JSON.stringify(net, null, 2) + "\n");
    }
  }

  console.log(`\n${changed} chain(s) ${write ? "updated" : "would change"}`);
  if (issues.length) {
    console.log(`\n=== issues (${issues.length}) ===`);
    for (const i of issues.sort()) console.log(`  - ${i}`);
  }
  if (write) console.log(`\nRun \`bun format\` to normalise the JSON.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
