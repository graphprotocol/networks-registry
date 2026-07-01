import fs from "fs";
import { getAllJsonFiles } from "./utils/fs";
import { fetchChainListNetworks } from "./utils/chainlist";
import { Network } from "./types/registry";

// RPC cleanup / audit tool.
//
// For every EVM (eip155) network it gathers candidate RPC endpoints (the ones already
// in the registry plus public ones from chainlist.org) and probes each for:
//   - correct chainId (eth_chainId matches caip2Id)
//   - firstStreamableBlock is correct (block hash at that height matches firehose.firstStreamableBlock.id)
//   - archive capability (historical state query at firstStreamableBlock.height succeeds)
// then keeps up to --max verified archive endpoints per chain (existing ones first, in
// their original order, then public additions).
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
const DEMO_KEY =
  /docs-demo|dkey=|[?&]token=|\/v1\/[0-9a-f]{20,}|\/rpc\/[0-9a-f]{20,}|\/[0-9a-f]{32,}(\/|$)/i;
const isUsablePublic = (u: string) =>
  !!u &&
  !u.includes("${") &&
  !u.includes("API_KEY") &&
  !u.startsWith("ws") &&
  !DEMO_KEY.test(u);
const eqHash = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
// Pinax first-party endpoints are always preserved (never dropped by cleanup), even if
// they are temporarily down / not archive — those are reported as issues instead.
const isPinax = (u: string) => u.includes("rpc.service.pinax.network");

type Probe = {
  url: string;
  reachable: boolean;
  chainId?: number;
  blockHash?: string | null;
  archive?: boolean;
  err?: string;
  archiveErr?: string | null;
};

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

  const chainlist = await fetchChainListNetworks();
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

    const clRpcs = (clById.get(expected)?.rpc ?? []).map((r: any) => r.url);
    const candidates = [
      ...new Set([
        ...current.filter(isUsablePublic),
        ...clRpcs.filter(isUsablePublic),
      ]),
    ];
    if (!candidates.length) {
      if (!current.length) issues.push(`${net.id}: no RPC endpoints and none available`);
      continue;
    }

    const results = await pool(candidates, (u) => probe(u, height));
    const byUrl = new Map(results.map((r) => [r.url, r]));

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
      if (!r.url.includes("rpc.service.pinax.network")) continue;
      if (!r.reachable) issues.push(`${net.id}: Pinax ${r.url} DOWN (${r.err})`);
      else if (r.chainId !== expected)
        issues.push(`${net.id}: Pinax ${r.url} wrong chainId ${r.chainId}`);
      else if (!r.archive)
        issues.push(`${net.id}: Pinax ${r.url} NOT archive (${r.archiveErr})`);
    }

    // --- selection ---
    const isGood = (u: string) => {
      const r = byUrl.get(u);
      return (
        !!r &&
        r.reachable &&
        r.chainId === expected &&
        !!r.archive &&
        (r.blockHash ? eqHash(r.blockHash, fsbId) : true)
      );
    };
    // keep existing archive endpoints AND all Pinax endpoints (in original order)
    const survivingCurrent = current.filter((u) => isGood(u) || isPinax(u));
    const newPublic = results
      .filter((r) => isGood(r.url) && !isPinax(r.url) && !current.includes(r.url))
      .sort((a, b) => {
        const ta = trackRank[String(trackingOf(expected, a.url))];
        const tb = trackRank[String(trackingOf(expected, b.url))];
        return ta !== tb ? ta - tb : a.url.length - b.url.length;
      })
      .map((r) => r.url);
    let chosen = [...survivingCurrent, ...newPublic].slice(0, max);

    if (!chosen.length) {
      // no archive node — keep reachable+correct current endpoints as a fallback
      const fb = current.filter((u) => {
        const r = byUrl.get(u);
        return (
          r?.reachable &&
          r.chainId === expected &&
          (r.blockHash ? eqHash(r.blockHash, fsbId) : true)
        );
      });
      if (fb.length) {
        chosen = fb.slice(0, max);
        issues.push(`${net.id}: no archive RPC found — kept reachable official RPC(s)`);
      } else {
        issues.push(`${net.id}: no verified RPC — left unchanged for manual review`);
        continue;
      }
    } else if (chosen.length < max) {
      issues.push(`${net.id}: only ${chosen.length}/${max} archive RPC(s) available`);
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
