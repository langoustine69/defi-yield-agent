import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import yieldData from "./data/yields.json";

const app = new Hono();

// Middleware
app.use("/*", cors());

// Types
interface Pool {
  asset: string;
  apy: number;
  tvl: number;
  risk: string;
}

interface Protocol {
  name: string;
  chain: string;
  category: string;
  pools: Pool[];
}

// Pricing tiers
const PRICING = {
  free: { price: 0, description: "Basic yield summary" },
  topYields: { price: 0.001, description: "Top yields across DeFi" },
  protocolDeep: { price: 0.002, description: "Deep dive on specific protocol" },
  rwaOpportunities: { price: 0.003, description: "RWA investment opportunities" },
  yieldCompare: { price: 0.002, description: "Compare yields across protocols" },
  riskAnalysis: { price: 0.005, description: "Risk-adjusted yield analysis" },
};

// Health check
app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    agent: "defi-yield-research",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// Agent card (Lucid Agents standard)
app.get("/.well-known/ai-plugin.json", (c) => {
  return c.json({
    schema_version: "v1",
    name: "DeFi Yield Research Agent",
    description: "Real-time DeFi yields, RWA opportunities, treasury rates, and risk analysis",
    author: "langoustine69",
    contact: "master-claud@agentmail.to",
    logo_url: "https://langoustine69.github.io/pfp.png",
    endpoints: [
      { path: "/api/yields/summary", method: "GET", price: PRICING.free },
      { path: "/api/yields/top", method: "GET", price: PRICING.topYields },
      { path: "/api/protocol/:name", method: "GET", price: PRICING.protocolDeep },
      { path: "/api/rwa", method: "GET", price: PRICING.rwaOpportunities },
      { path: "/api/compare", method: "GET", price: PRICING.yieldCompare },
      { path: "/api/risk-analysis", method: "GET", price: PRICING.riskAnalysis },
    ],
    paymentAddress: process.env.PAYMENTS_RECEIVABLE_ADDRESS ?? null,
    chains: ["base"],
  });
});

// === FREE ENDPOINT ===
// GET /api/yields/summary - Basic market overview
app.get("/api/yields/summary", (c) => {
  const protocols = yieldData.protocols as Protocol[];
  const totalTVL = protocols.reduce(
    (sum, p) => sum + p.pools.reduce((s, pool) => s + pool.tvl, 0),
    0
  );
  
  const avgYield = protocols.reduce((sum, p) => {
    const protocolAvg = p.pools.reduce((s, pool) => s + pool.apy, 0) / p.pools.length;
    return sum + protocolAvg;
  }, 0) / protocols.length;

  return c.json({
    market: {
      totalTVL: `$${(totalTVL / 1e9).toFixed(1)}B`,
      protocolCount: protocols.length,
      avgYield: `${avgYield.toFixed(1)}%`,
      lastUpdated: yieldData.lastUpdated,
    },
    treasuryRates: {
      "10Y": `${yieldData.treasuryRates.US["10Y"]}%`,
      "2Y": `${yieldData.treasuryRates.US["2Y"]}%`,
    },
    topCategories: ["RWA", "Lending", "Yield Trading"],
    note: "Use paid endpoints for detailed yield data",
  });
});

// === PAID ENDPOINT 1 ===
// GET /api/yields/top - Top yields across all protocols
app.get("/api/yields/top", (c) => {
  const limit = parseInt(c.req.query("limit") || "10");
  const minTVL = parseInt(c.req.query("minTvl") || "0");
  const riskFilter = c.req.query("risk"); // low, medium, high

  const protocols = yieldData.protocols as Protocol[];
  const allPools: Array<Pool & { protocol: string; chain: string; category: string }> = [];

  for (const protocol of protocols) {
    for (const pool of protocol.pools) {
      if (pool.tvl >= minTVL && (!riskFilter || pool.risk === riskFilter)) {
        allPools.push({
          ...pool,
          protocol: protocol.name,
          chain: protocol.chain,
          category: protocol.category,
        });
      }
    }
  }

  const sorted = allPools.sort((a, b) => b.apy - a.apy).slice(0, limit);

  return c.json({
    topYields: sorted.map((p, i) => ({
      rank: i + 1,
      protocol: p.protocol,
      asset: p.asset,
      apy: `${p.apy}%`,
      tvl: `$${(p.tvl / 1e6).toFixed(1)}M`,
      chain: p.chain,
      category: p.category,
      risk: p.risk,
    })),
    filters: { limit, minTVL, risk: riskFilter || "all" },
    pricing: PRICING.topYields,
  });
});

// === PAID ENDPOINT 2 ===
// GET /api/protocol/:name - Deep dive on specific protocol
app.get("/api/protocol/:name", (c) => {
  const name = c.req.param("name").toLowerCase();
  const protocols = yieldData.protocols as Protocol[];
  
  const protocol = protocols.find(
    (p) => p.name.toLowerCase().includes(name)
  );

  if (!protocol) {
    return c.json({ error: "Protocol not found", available: protocols.map(p => p.name) }, 404);
  }

  const totalTVL = protocol.pools.reduce((sum, p) => sum + p.tvl, 0);
  const avgAPY = protocol.pools.reduce((sum, p) => sum + p.apy, 0) / protocol.pools.length;
  const bestPool = protocol.pools.reduce((best, p) => p.apy > best.apy ? p : best);
  const safestPool = protocol.pools.filter(p => p.risk === "low").sort((a, b) => b.apy - a.apy)[0];

  return c.json({
    protocol: {
      name: protocol.name,
      chain: protocol.chain,
      category: protocol.category,
      totalTVL: `$${(totalTVL / 1e9).toFixed(2)}B`,
      avgAPY: `${avgAPY.toFixed(2)}%`,
    },
    pools: protocol.pools.map(p => ({
      asset: p.asset,
      apy: `${p.apy}%`,
      tvl: `$${(p.tvl / 1e6).toFixed(1)}M`,
      risk: p.risk,
    })),
    recommendations: {
      bestYield: { asset: bestPool.asset, apy: `${bestPool.apy}%`, risk: bestPool.risk },
      safestOption: safestPool ? { asset: safestPool.asset, apy: `${safestPool.apy}%` } : null,
    },
    pricing: PRICING.protocolDeep,
  });
});

// === PAID ENDPOINT 3 ===
// GET /api/rwa - RWA opportunities
app.get("/api/rwa", (c) => {
  const accreditedOnly = c.req.query("accredited") === "true";
  const maxMin = parseInt(c.req.query("maxMinInvestment") || "1000000");

  let opportunities = yieldData.rwaOpportunities;
  
  if (accreditedOnly) {
    opportunities = opportunities.filter(o => o.accredited);
  }
  opportunities = opportunities.filter(o => o.minInvestment <= maxMin);

  // Add RWA protocols from main data
  const rwaProtocols = (yieldData.protocols as Protocol[]).filter(p => p.category === "RWA");

  return c.json({
    rwaMarket: {
      totalOpportunities: opportunities.length + rwaProtocols.length,
      avgYield: `${(opportunities.reduce((s, o) => s + o.yield, 0) / opportunities.length).toFixed(1)}%`,
      trend: "growing",
    },
    tokenizedProducts: opportunities.map(o => ({
      name: o.name,
      type: o.type,
      yield: `${o.yield}%`,
      minInvestment: `$${o.minInvestment.toLocaleString()}`,
      chain: o.chain,
      accreditedOnly: o.accredited,
    })),
    onChainRWA: rwaProtocols.map(p => ({
      protocol: p.name,
      pools: p.pools.map(pool => ({
        asset: pool.asset,
        apy: `${pool.apy}%`,
        tvl: `$${(pool.tvl / 1e6).toFixed(0)}M`,
      })),
    })),
    treasuryComparison: {
      "US 10Y Treasury": `${yieldData.treasuryRates.US["10Y"]}%`,
      note: "RWA yields often backed by similar instruments",
    },
    pricing: PRICING.rwaOpportunities,
  });
});

// === PAID ENDPOINT 4 ===
// GET /api/compare - Compare yields across protocols
app.get("/api/compare", (c) => {
  const asset = c.req.query("asset")?.toUpperCase() || "USDC";
  const chains = c.req.query("chains")?.split(",") || [];

  const protocols = yieldData.protocols as Protocol[];
  const comparisons: Array<{
    protocol: string;
    chain: string;
    apy: number;
    tvl: number;
    risk: string;
  }> = [];

  for (const protocol of protocols) {
    if (chains.length > 0 && !chains.includes(protocol.chain.toLowerCase())) continue;
    
    for (const pool of protocol.pools) {
      if (pool.asset.toUpperCase().includes(asset)) {
        comparisons.push({
          protocol: protocol.name,
          chain: protocol.chain,
          apy: pool.apy,
          tvl: pool.tvl,
          risk: pool.risk,
        });
      }
    }
  }

  const sorted = comparisons.sort((a, b) => b.apy - a.apy);
  const best = sorted[0];
  const safest = sorted.filter(c => c.risk === "low").sort((a, b) => b.apy - a.apy)[0];

  return c.json({
    asset,
    comparisons: sorted.map(c => ({
      protocol: c.protocol,
      chain: c.chain,
      apy: `${c.apy}%`,
      tvl: `$${(c.tvl / 1e6).toFixed(0)}M`,
      risk: c.risk,
    })),
    recommendation: {
      highestYield: best ? { protocol: best.protocol, apy: `${best.apy}%`, risk: best.risk } : null,
      bestRiskAdjusted: safest ? { protocol: safest.protocol, apy: `${safest.apy}%` } : null,
      spread: best && safest ? `${(best.apy - safest.apy).toFixed(1)}% yield premium for higher risk` : null,
    },
    pricing: PRICING.yieldCompare,
  });
});

// === PAID ENDPOINT 5 ===
// GET /api/risk-analysis - Risk-adjusted yield analysis
app.get("/api/risk-analysis", (c) => {
  const protocols = yieldData.protocols as Protocol[];
  
  // Calculate risk-adjusted metrics
  const riskMultipliers = { low: 1.0, medium: 0.7, high: 0.4 };
  
  const analyzed: Array<{
    protocol: string;
    asset: string;
    rawAPY: number;
    riskAdjustedAPY: number;
    risk: string;
    tvl: number;
    sharpeProxy: number;
  }> = [];

  for (const protocol of protocols) {
    for (const pool of protocol.pools) {
      const riskMult = riskMultipliers[pool.risk as keyof typeof riskMultipliers] || 0.5;
      const riskAdjusted = pool.apy * riskMult;
      const riskFreeRate = yieldData.treasuryRates.US["3M"];
      const sharpeProxy = (pool.apy - riskFreeRate) / (pool.risk === "low" ? 2 : pool.risk === "medium" ? 5 : 10);

      analyzed.push({
        protocol: protocol.name,
        asset: pool.asset,
        rawAPY: pool.apy,
        riskAdjustedAPY: riskAdjusted,
        risk: pool.risk,
        tvl: pool.tvl,
        sharpeProxy,
      });
    }
  }

  const byRiskAdjusted = [...analyzed].sort((a, b) => b.riskAdjustedAPY - a.riskAdjustedAPY);
  const bySharpe = [...analyzed].sort((a, b) => b.sharpeProxy - a.sharpeProxy);

  return c.json({
    methodology: {
      riskMultipliers,
      riskFreeRate: `${yieldData.treasuryRates.US["3M"]}% (3M Treasury)`,
      note: "Sharpe proxy = (APY - risk-free) / volatility estimate",
    },
    topRiskAdjusted: byRiskAdjusted.slice(0, 10).map(a => ({
      protocol: a.protocol,
      asset: a.asset,
      rawAPY: `${a.rawAPY}%`,
      riskAdjustedAPY: `${a.riskAdjustedAPY.toFixed(1)}%`,
      risk: a.risk,
      tvl: `$${(a.tvl / 1e6).toFixed(0)}M`,
    })),
    topSharpeRatio: bySharpe.slice(0, 5).map(a => ({
      protocol: a.protocol,
      asset: a.asset,
      sharpeProxy: a.sharpeProxy.toFixed(2),
      apy: `${a.rawAPY}%`,
      risk: a.risk,
    })),
    portfolioSuggestion: {
      conservative: byRiskAdjusted.filter(a => a.risk === "low").slice(0, 3).map(a => `${a.protocol} ${a.asset}`),
      balanced: byRiskAdjusted.filter(a => a.risk !== "high").slice(0, 5).map(a => `${a.protocol} ${a.asset}`),
      aggressive: byRiskAdjusted.slice(0, 5).map(a => `${a.protocol} ${a.asset}`),
    },
    pricing: PRICING.riskAnalysis,
  });
});

// Start server
const port = parseInt(process.env.PORT || "3000");
console.log(`🦞 DeFi Yield Agent running on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
